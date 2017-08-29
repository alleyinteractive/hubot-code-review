sendFancyMessage = require './lib/sendFancyMessage'
schedule = require 'node-schedule'

class CodeReviewKarma
  constructor: (@robot) ->
    @scores = {}
    @monthly_scores = {}

    @monthly_award_schedule = '0 0 1 * *'       # midnight on the first of every month
    @monthly_award_cron = null

    @robot.brain.on 'loaded', =>
      if @robot.brain.data.code_review_karma
        cache = @robot.brain.data.code_review_karma
        @scores = cache.scores || {}
        @monthly_scores = cache.monthly_scores || {}

    # Schedule Monthly Award and Score Reset
    unless @monthly_award_cron
      if (process.env.HUBOT_CODE_REVIEW_KARMA_MONTHLY_AWARD_ROOM)?
        @monthly_award_cron = schedule.scheduleJob 'CodeReviewKarma.monthly_award_cron', @monthly_award_schedule, () =>
          @monthly_award()

  # Update Redis store of CR queues and karma scores
  # @return none
  update_redis: ->
    @robot.brain.data.code_review_karma = { scores: @scores, monthly_scores: @monthly_scores }

  # Increment user's karma score
  # @param string user Name of user
  # @param string dir Direction property, 'take' or 'give'
  # @param int qty Amount to increment by
  # @return none
  incr_score: (user, dir, qty = 1) ->
    qty -= 0
    @scores[user] ||= { give: 0, take: 0 }
    @scores[user][dir] += qty
    @monthly_scores[user] ||= { give: 0, take: 0 }
    @monthly_scores[user][dir] += qty

    @update_redis()

  # Decrement user's karma score
  # @param string user Name of user
  # @param string dir Direction property, 'take' or 'give'
  # @param int qty Amount to decrement by
  # @return none
  decr_score: (user, dir, qty = 1) ->
    qty -= 0
    if @scores[user] and @scores[user][dir]
      @scores[user][dir] -= qty
      @scores[user][dir] = 0 if @scores[user][dir] < 0
    if @monthly_scores[user] and @monthly_scores[user][dir]
      @monthly_scores[user][dir] -= qty
      @monthly_scores[user][dir] = 0 if @monthly_scores[user][dir] < 0
    @update_redis()

  # Calculate karm score
  # @param int give CRs given
  # @param int take CRs taken
  # @return int Karma score
  karma: (give, take) ->
    if take is 0
      return give
    return Math.round( ( give / take - 1 ) * 100 ) / 100

  # Get leaderboard of gives, takes, and karma score
  # @return array Array of most CRs given, most CRs taken, best karma score
  rankings: ->
    gives = takes = karmas = { score: -1, user: 'Nobody' }
    for user, scores of @scores
      if scores.give > gives.score
        gives = { score: scores.give, user: user }
      else if scores.give == gives.score
        gives.user = gives.user + ', ' + user

      if scores.take > takes.score
        takes = { score: scores.take, user: user }
      else if scores.take == takes.score
        takes.user = takes.user + ', ' + user

      karma = @karma(scores.give, scores.take)
      if karma > karmas.score
        karmas = { score: karma, user: user }
      else if karma == karmas.score
        karmas.user = karmas.user + ', ' + user

    [gives, takes, karmas ]

  # Get user's score
  # @param string user User name
  # @return obj Key-value of CRs given and taken
  scores_for_user: (user) ->
    all_scores = @scores[user] || { give: 0, take: 0 }
    month_scores = @monthly_scores[user] || { give: 0, take: 0 }
    return {
      all_scores,
      month_scores
    }

  # Remove user from scores
  # @return bool True if user was found; false if user not found
  remove_user: (user) ->
    if @scores[user] || @monthly_scores[user]
      if @scores[user]
        delete @scores[user]
      if @monthly_scores[user]
        delete @monthly_scores[user]
      @update_redis()
      return true
    return false

  # Reset all scores
  # @return none
  flush_scores: ->
    @scores = {}
    @monthly_scores = {}
    @update_redis()
    clearTimeout @current_timeout if @current_timeout

  # Announce top 5 reviewers
  # via cron: HUBOT_CODE_REVIEW_KARMA_MONTHLY_AWARD_ROOM
  # via msg: to the original room
  #
  # @return none
  monthly_award: (msg = null) ->
    msg_prefix = ""
    attachments = []

    if (msg)? # Prompt from message (vs. cron)
      msg_prefix = "Here's how things stand:"
      award_room = msg.message.room
    else # Triggered from cron
      msg_prefix = "Here's the leaderboard for this month:"
      award_room = "\##{process.env.HUBOT_CODE_REVIEW_KARMA_MONTHLY_AWARD_ROOM}"
    return unless (award_room)?
    reviews_this_month = Object.keys(@monthly_scores).length

    if reviews_this_month is 0
      attachments.push
        fallback: "No code reviews seen this month yet."
        text: "No code reviews seen this month yet. :cricket:"
        color: "#C0C0C0"
    else
      top_5 = Object.keys(@monthly_scores)
        .map((index) =>
          return {
            user: index,
            give: @monthly_scores[index].give,
            take: @monthly_scores[index].take,
            karma: @karma(@monthly_scores[index].give, @monthly_scores[index].take)
          }
        ).sort((a, b) ->
          return a.give - b.give
        ).slice(0, 5)
      for index of top_5
        placement = parseInt(index) + 1 # Shift for 0 start array
        switch(placement)
          when 1 then medal_color = "#D4AF37" # gold
          when 2 then medal_color = "#BCC6CC" # silver
          when 3 then medal_color = "#5B391E" # bronze
          else medal_color = "#CCCCCC" # gray
        entry = top_5[index]
        user_detail = @robot.brain.userForName("#{entry.user}")
        gravatar = user_detail.slack.profile.image_72
        score_field_array = []
        score_field_array.push
          title: "Reviewed / Taken",
          value: "*#{entry.give}* / *#{entry.take}*",
          short: true
        score_field_array.push
          title: "Karma Score",
          value: "*#{entry.karma}*",
          short: true
        attachments.push
          fallback: "#{entry.user}: Reviewed #{entry.give}, Taken #{entry.take}, Karma: #{entry.karma}"
          text: "*\##{placement} - #{user_detail.slack.real_name}* (@#{entry.user}): "
          fields: score_field_array
          mrkdwn_in: ["text", "fields"]
          color: medal_color
          thumb_url: gravatar

    sendFancyMessage(@robot, "#{award_room}", attachments)
    # If triggered by monthly cron task, reset the monthly scores
    unless (msg)?
      @monthly_scores = {}
      @update_redis()


module.exports = CodeReviewKarma