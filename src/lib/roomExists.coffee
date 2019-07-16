# Test whether slack room still exists as named
# (eg. when rooms are archived)
# @param  {msg Object}
# @return bool true/false whether the slack room exists
module.exports = (roomName, robot) ->
  if robot.adapterName is "slack"
    cursor = null # When cursor is null, Slack provides first 'page'
    async.whilst (() ->
      ! (cursor is '') # Slack uses an empty string cursor to indicate no more
    ), ((step) =>
      # Async query conversations.list
      robot.adapter.client.web.conversations.list({
        limit: 1000,
        #types: "public_channel,private_channel,im,mpim",
        types: "public_channel",
        exclude_archived: true,
        cursor
      })
      .then (body) =>
        if body.ok
          # Set new cursor 'page'
          cursor = body.response_metadata.next_cursor

          valid_channel_ids = body.channels
            .filter((each) -> ((! each.is_archived and each.is_member) or
            (each.is_im is true)))
            .map((each) -> (each.id))
          valid_channel_names = body.channels
            .filter((each) -> ((! each.is_archived and each.is_member) or
            (each.is_im is true)))
            .map((each) -> (each.name))
          found = (roomName in valid_channel_ids or roomName in valid_channel_names)
          if found
            # Stop looking
            cursor = ''

          step(found)
        else
          @robot.logger.error "Unable to call conversations.list:", body
    ), (found) ->
      if not found
        return false
      else return true

  else
    # assume room exists for alternate adapters (eg. local development)
    return true
