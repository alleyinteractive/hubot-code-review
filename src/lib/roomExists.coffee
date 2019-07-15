# Test whether slack room still exists as named
# (eg. when rooms are archived)
# @param  {msg Object}
# @return bool true/false whether the slack room exists
module.exports = (roomName, robot) ->
  if robot.adapterName is "slack"

    robot.http("https://slack.com/api/conversations.list")
      .query({
        token: process.env.HUBOT_SLACK_TOKEN
        limit: 1000
        # TODO: use cursor-based pagination
        types: "public_channel,private_channel"
      })
      .get() (err, response, body) =>
        channels = JSON.parse(body)
        valid_channel_ids = channels.channels
          .filter((each) => (! each.is_archived and each.is_member))
          .map((each) => (each.id))
        valid_channel_names = channels.channels
          .filter((each) => (! each.is_archived and each.is_member))
          .map((each) => (each.name))

        if roomName not in valid_channel_ids and
        roomName not in valid_channel_names
          return false
        else
          return true
  else
    # assume room exists for alternate adapters (eg. local development)
    return true
