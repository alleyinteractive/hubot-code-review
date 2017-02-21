# Return the human-readable name of the channel the msg was sent in
# for hubot-slack's breaking change from 3->4 of using ID instead of name
# @param  {msg Object}
# @return String human-readable name of the channel
module.exports = (msg) ->
  if msg.robot.adapterName is "slack"
    channel = msg.robot.adapter.client.rtm.dataStore.getChannelGroupOrDMById(msg.message.room)
    return channel.name
  else
    return msg.message.room