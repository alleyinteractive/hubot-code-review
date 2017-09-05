# Description:
#   Keep track of code review karma
#
# Dependencies:
#   None
#
# Configuration:
#   see README.md -> docs/code-review-karma.md

CodeReviewKarma = require './CodeReviewKarma'

module.exports = (robot) ->
  unless (process.env.HUBOT_CODE_REVIEW_KARMA_DISABLED)?
    code_review_karma = new CodeReviewKarma robot

    robot.respond /(?:what (?:is|are) the )?(?:code review|cr) (?:rankings|leaderboard)\??/i,
    (msg) ->
      [gives, takes, karmas] = code_review_karma.rankings()
      msg.send [
        "#{gives.user} #{if gives.user.indexOf(',') > -1 then 'have' else 'has'}" +
        " done the most reviews with #{gives.score}",
        "#{takes.user} #{if takes.user.indexOf(',') > -1 then 'have' else 'has'}" +
        " asked for the most code reviews with #{takes.score}",
        "#{karmas.user} #{if karmas.user.indexOf(',') > -1 then 'have' else 'has'}" +
        " the best code karma score with #{karmas.score}"
      ].join("\n")

    robot.respond /list (?:all )?(?:code review|cr) scores/i, (msg) ->
      output = []
      for user, scores of code_review_karma.scores
        output.push "#{user} has received #{scores.take} reviews and given #{scores.give}." +
        " Code karma: #{code_review_karma.karma(scores.give, scores.take)}"
      msg.send output.join("\n")

    robot.respond /what (?:is|are) (\w+)(?:'s?)? cr scores?\??/i, (msg) ->
      if 'my' is msg.match[1].toLowerCase()
        # Handle case of msg using user (unit test) vs. user.name (slack adapter)
        user = if (msg.message.user.name)? then msg.message.user.name else msg.message.user
      else
        user = msg.match[1]
      scores = code_review_karma.scores_for_user user

      msg.send "#{user} has received #{scores.all_scores.take} reviews " +
      "and given #{scores.all_scores.give}. Code karma: " +
      "#{code_review_karma.karma(scores.all_scores.give, scores.all_scores.take)}"

    robot.respond /remove ([-_a-z0-9]+) from cr rankings/i, (msg) ->
      user = msg.match[1]
      scores = code_review_karma.scores_for_user user
      if code_review_karma.remove_user user
        msg.send "Removing #{user}, who currently has received #{scores.all_scores.take}" +
        " reviews and given #{scores.all_scores.give}..."
      else
        msg.send "I could not remove #{user} from the CR rankings"

    # coffeelint: disable=max_line_length
    robot.respond /(?:what (?:is|are) the )?monthly (?:code review|cr) (?:rankings|leaderboard)\??/i, (msg) ->
    # coffeelint: enable=max_line_length
      code_review_karma.monthly_rankings(msg)

    robot.respond /merge ([-_a-z0-9]+)(?:'s?)? cr scores into ([-_a-z0-9]+)/i, (msg) ->
      old_user = msg.match[1]
      new_user = msg.match[2]
      scores = code_review_karma.scores_for_user old_user
      msg.send "Removing #{old_user}, who currently has received #{scores.all_scores.take}" +
      " reviews and given #{scores.all_scores.give}..."
      if code_review_karma.remove_user old_user
        msg.send "I removed #{old_user} from the CR rankings"

        code_review_karma.incr_score new_user, 'take', scores.take
        code_review_karma.incr_score new_user, 'give', scores.give
        msg.send "I added #{scores.give} and #{scores.take} give and" +
        " take points respectively to #{old_user}"

        new_score = code_review_karma.scores_for_user new_user
        msg.send "#{new_user} has now received #{new_score.take} reviews and given" +
        "#{new_score.give}. Code karma: #{code_review_karma.karma(new_score.give, new_score.take)}"
      else
        msg.send "I could not remove #{user} from the CR rankings"

  # return for use in unit tests
  return code_review_karma