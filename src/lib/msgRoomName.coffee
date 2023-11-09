# Return the human-readable name of the channel the msg was sent in
# for hubot-slack's breaking change from 3->4 of using ID instead of name
# @param  {msg Object}
# @param  {next Function} callback
# @param  {retryCount Number} number of times this function has been retried
# @return String human-readable name of the channel
module.exports = (msg, next, retryCount = 0) ->
  if msg.robot.adapterName is "slack"
    msg.robot.http("https://slack.com/api/conversations.info")
      .query({
        channel: msg.message.room
      })
      .header('Authorization', 'Bearer ' + process.env.HUBOT_SLACK_TOKEN)
      .get() (err, response, body) ->
        if err || response.ok is false || !response.channel
          if retryCount < 3 # Retry up to 3 times
            console.warn "Retrying to get channel info for #{msg.message.room}"
            console.warn "[Attempt #{retryCount+ 1}]"
            module.exports(msg, next, retryCount + 1)
          else
            console.error "Failed to get channel name after retries for #{msg.message.room}"
            next null # Signal failure after retries
        else
          next response.channel.name
  else
    next msg.message.room