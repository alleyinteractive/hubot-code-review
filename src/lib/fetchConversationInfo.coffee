# Fetch conversation information from the Slack API
#
# @link https://api.slack.com/methods/conversations.info
#
# @param {Object} robot The hubot robot object.
# @returns {Promise<Object>} The Slack conversation object.
module.exports = (robot, next) -> new Promise (resolve, reject) ->
  channelId = msg.message.room
  if robot.adapterName is "slack"
    queryData =  {
      token: process.env.HUBOT_SLACK_TOKEN
      channel: channelId
    }
    # Query slack API for the message
    msg.robot.http("https://slack.com/api/conversations.info")
      .query(queryData)
      .get() (histErr, histResponse, histBody) =>
        resp = JSON.parse(histBody)
        resolve resp.channel
  else
    resolve null
