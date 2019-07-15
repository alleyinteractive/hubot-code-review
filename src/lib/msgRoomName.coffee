# Return the human-readable name of the channel the msg was sent in
# for hubot-slack's breaking change from 3->4 of using ID instead of name
# @param  {msg Object}
# @return String human-readable name of the channel
module.exports = (msg) ->
  if msg.robot.adapterName is "slack"
    msg.robot.http("https://slack.com/api/conversations.info")
      .query({
        token: process.env.HUBOT_SLACK_TOKEN
        channel: msg.message.room
      })
      .get() (err, response, body) =>
        channel = JSON.parse(body)
        return channel.name
  else
    return msg.message.room