sendFancyMessage = require './lib/sendFancyMessage'
schedule = require 'node-schedule'

class CodeReviewKarma
  constructor: (@robot) ->
    @scores = {}
    @monthly_scores = {}

    @monthly_rankings_schedule = '0 0 1 * *'       # midnight on the first of every month
    @monthly_rankings_cron = null

    @robot.brain.on 'loaded', =>
      if @robot.brain.data.code_review_karma
        cache = @robot.brain.data.code_review_karma
        @scores = cache.scores || {}
        @monthly_scores = cache.monthly_scores || {}

    # Schedule Monthly Award and Score Reset
    unless @monthly_rankings_cron
      @monthly_rankings_cron = schedule.scheduleJob 'CodeReviewKarma.monthly_rankings_cron', @monthly_rankings_schedule, () =>
        @monthly_rankings()

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
    console.log "CodeReviewKarma.flush_scores: resetting all scores..."
    @scores = {}
    @monthly_scores = {}
    @update_redis()

  # Reset monthly scores
  # @return none
  flush_monthly_scores: ->
    console.log "CodeReviewKarma.flush_monthly_scores: resetting monthly_scores..."
    @monthly_scores = {}
    @update_redis()

  # Announce top 5 reviewers
  # via cron: HUBOT_CODE_REVIEW_KARMA_MONTHLY_AWARD_ROOM
  # via msg: to the original room
  #
  # @return none
  monthly_rankings: (msg = null) ->
    msg_prefix = ""
    attachments = []

    if (msg)?
      # function start from message (not cron)
      msg_prefix = "Here's how things stand this month:"
      announce_room = msg.message.room
    else if (process.env.HUBOT_CODE_REVIEW_KARMA_MONTHLY_AWARD_ROOM)?
      # Triggered from cron and HUBOT_CODE_REVIEW_KARMA_MONTHLY_AWARD_ROOM set
      msg_prefix = "Here's the final code review leaderboard for last month:"
      announce_room = "\##{process.env.HUBOT_CODE_REVIEW_KARMA_MONTHLY_AWARD_ROOM}"
    else
      # Triggered from cron, no room set... clear monthly_scores and return
      @flush_monthly_scores()
      return
    reviews_this_month = Object.keys(@monthly_scores).length

    if reviews_this_month is 0
      attachments.push
        fallback: "No code reviews seen this month yet."
        text: "No code reviews seen this month yet. :cricket:"
        color: "#C0C0C0"
    else
      attachments.push
        fallback: msg_prefix
        pretext: msg_prefix
      # Top three most reviews given followed by karma
      top_3_reviewers = Object.keys(@monthly_scores)
        .map((index) =>
          return {
            user: index,
            list: 'Most Reviews',
            give: @monthly_scores[index].give,
            take: @monthly_scores[index].take,
            karma: @karma(@monthly_scores[index].give, @monthly_scores[index].take)
          }
        ).sort((a, b) ->
          if b.give is a.give
            return b.karma - a.karma
          else
            return b.give - a.give
        ).map((winner, rank) =>
          return Object.assign({}, winner, { placement: rank + 1 })
        ).slice(0, 3)
      # Top three most reviews requested followed by karma
      top_3_requesters = Object.keys(@monthly_scores)
        .map((index) =>
          return {
            user: index,
            list: 'Most Requests',
            give: @monthly_scores[index].give,
            take: @monthly_scores[index].take,
            karma: @karma(@monthly_scores[index].give, @monthly_scores[index].take)
          }
        ).sort((a, b) -> # Sort by most reviews given followed by karma
          if b.take is a.take
            return b.karma - a.karma
          else
            return b.take - a.take
        ).map((winner, rank) =>
          return Object.assign({}, winner, { placement: rank + 1 })
        ).slice(0, 3)
      # Top three best karma followed by reviews
      top_1_karma = Object.keys(@monthly_scores)
        .map((index) =>
          return {
            user: index,
            list: 'Best Karma'
            give: @monthly_scores[index].give,
            take: @monthly_scores[index].take,
            karma: @karma(@monthly_scores[index].give, @monthly_scores[index].take)
          }
        ).sort((a, b) -> # Sort by most reviews given followed by karma
          if b.karma is a.karma
            return b.give - a.give
          else
            return b.karma - a.karma
        ).map((winner, rank) =>
          return Object.assign({}, winner, { placement: rank + 1 })
        ).slice(0, 1)

      monthly_leaderboard = [top_3_reviewers..., top_3_requesters..., top_1_karma...]
      for index of monthly_leaderboard
        entry = monthly_leaderboard[index]
        switch(entry.placement)
          when 1 then medal_color = "#D4AF37" # gold
          when 2 then medal_color = "#BCC6CC" # silver
          when 3 then medal_color = "#5B391E" # bronze
          else medal_color = "#FFFFFF" # white
        user_detail = @robot.brain.userForName("#{entry.user}")
        if (user_detail)? and (user_detail.slack)? # if slack, add some deeper data
          gravatar = user_detail.slack.profile.image_72
          full_name = user_detail.slack.real_name
        else
          full_name = entry.user
        score_field_array = []
        switch (entry.list)
          when 'Most Reviews'
            reviewed_requested_text = "*#{entry.give}* / #{entry.take}"
            karma_text = "#{entry.karma}"
          when 'Most Requests'
            reviewed_requested_text = "#{entry.give} / *#{entry.take}*"
            karma_text = "#{entry.karma}"
          when 'Best Karma'
            reviewed_requested_text = "#{entry.give} / #{entry.take}"
            karma_text = "*#{entry.karma}*"
        score_field_array.push
          title: "Reviewed / Requested",
          value: reviewed_requested_text,
          short: true
        score_field_array.push
          title: "Karma Score",
          value: karma_text,
          short: true
        attachments.push
          fallback: "#{full_name}: Reviewed #{entry.give}, Requested #{entry.take}, Karma: #{entry.karma}"
          text: "\#*_#{entry.placement}_ #{entry.list}* - *#{full_name}* (@#{entry.user}): "
          fields: score_field_array
          mrkdwn_in: ["text", "fields"]
          color: medal_color
          thumb_url: gravatar

    sendFancyMessage(@robot, "#{announce_room}", attachments)
    # If triggered by monthly cron task, reset the monthly scores
    unless (msg)?
      @flush_monthly_scores()

module.exports = CodeReviewKarma