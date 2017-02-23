class CodeReviewKarma
  constructor: (@robot) ->
    @scores = {}

    @robot.brain.on 'loaded', =>
      if @robot.brain.data.code_review_karma
        cache = @robot.brain.data.code_review_karma
        @scores = cache.scores || {}

  # Update Redis store of CR queues and karma scores
  # @return none
  update_redis: ->
    @robot.brain.data.code_review_karma = { scores: @scores }

  # Increment user's karma score
  # @param string user Name of user
  # @param string dir Direction property, 'take' or 'give'
  # @param int qty Amount to increment by
  # @return none
  incr_score: (user, dir, qty = 1) ->
    qty -= 0
    @scores[user] ||= { give: 0, take: 0 }
    @scores[user][dir] += qty
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
    @update_redis()

  # Calculate karm score
  # @param int give CRs given
  # @param int take CRs taken
  # @return int Karma score
  karma: (give, take) ->
    if take == 0
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
    @scores[user] || { give: 0, take: 0 }

  # Remove user from scores
  # @return bool True if user was found; false if user not found
  remove_user: (user) ->
    if @scores[user]
      delete @scores[user]
      @update_redis()
      return true
    return false

  # Reset all scores
  # @return none
  flush_scores: ->
    @scores = {}
    @update_redis()
    clearTimeout @current_timeout if @current_timeout

module.exports = CodeReviewKarma