# Test whether slack room still exists as named
# (eg. when rooms are archived)
# @param  {msg Object}
# @return bool true/false whether the slack room exists
module.exports = (roomName, robot) ->
  if robot.adapterName is "slack"
    channel = robot.adapter.client.rtm.dataStore.getChannelOrGroupByName(roomName)
    # If the roomName is a (non-archived) group/channel whose name matches the input
    if channel? and
    channel.is_archived? and channel.is_archived isnt true and
    channel.name? and channel.name is roomName
      return true
    else
      return false
  else
    # assume room exists for alternate adapters (eg. local development)
    return true
