slackTeamId = null

# Return the Slack Team ID hubot is connected to
#
# https://api.slack.com/methods/team.info
#
# @return String The Slack Team ID hubot is connected to
module.exports = (msg, next) -> new Promise (resolve, reject) ->
  # Use the already-resolved value.
  if slackTeamId != null
    resolve slackTeamId
    return

  if msg.robot.adapterName is "slack"
    msg.robot.http("https://slack.com/api/team.info")
      .query({
        token: process.env.HUBOT_SLACK_TOKEN
      })
      .get() (err, response, body) ->
        channel = JSON.parse(body)
        slackTeamId = body.team.id
        resolve body.team.id
  else
    slackTeamId = false
    resolve false