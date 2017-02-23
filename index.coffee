# Description:
#   Manage code review reminders
#
# Dependencies:
#   None
#
# Configuration:
#   HUBOT_GITHUB_TOKEN
#   HUBOT_CODE_REVIEW_KARMA_DISABLED (if true, disable karma functionality)
#   HUBOT_CODE_REVIEW_EMOJI_APPROVE (if true, approve CRs with emojis in the comment)
#
# Commands:
#   hubot help crs - display code review help
#

Path  = require 'path'

module.exports = (robot) ->
  # Unless code review karma is disabled
  unless (process.env.HUBOT_CODE_REVIEW_KARMA_DISABLED)?
    robot.loadFile(Path.resolve(__dirname, "src"), "code-review-karma.coffee")
  robot.loadFile(Path.resolve(__dirname, "src"), "code-reviews.coffee")

