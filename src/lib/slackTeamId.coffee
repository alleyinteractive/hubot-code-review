slackTeamId = false

# Return the Slack Team ID hubot is connected to
#
# https://api.slack.com/methods/team.info
#
# @return Promise<String|Null> The Slack Team ID hubot is connected to.
module.exports = (msg, next) -> new Promise (resolve, reject) ->
  # Use the already-resolved value.
  if slackTeamId != false
    resolve slackTeamId
    return

  if msg.robot.adapterName is "slack"
    msg.robot.http("https://slack.com/api/team.info")
      .query({
        token: process.env.HUBOT_SLACK_TOKEN
      })
      .get() (err, response, body) ->
        payload = JSON.parse(body)
        slackTeamId = payload.team.id
        resolve payload.team.id
  else
    slackTeamId = null
    resolve null
