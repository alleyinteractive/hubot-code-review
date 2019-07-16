# Test whether slack room still exists as named
# (eg. when rooms are archived)
# @param  {msg Object}
# @return bool true/false whether the slack room exists

async = require 'async' # Included in slack/client

module.exports = (robot, next) ->
  if robot.adapterName is "slack"
    valid_channels = []
    cursor = null # When cursor is null, Slack provides first 'page'
    async.whilst (() ->
      ! (cursor is '') # Slack uses an empty string cursor to indicate no more
    ), ((step) =>
      robot.adapter.client.web.conversations.list({
        limit: 1000,
        types: "public_channel,private_channel,im,mpim",
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
            .filter((each) -> (each)) #filter out undefined
          valid_channel_names = body.channels
            .filter((each) -> ((! each.is_archived and each.is_member) or
            (each.is_im is true)))
            .map((each) -> (each.name))
            .filter((each) -> (each)) #filter out undefined

          # Append names and ids to valid_channels
          valid_channels.push.apply(valid_channels, valid_channel_ids.concat(valid_channel_names))

          step()
        else
          @robot.logger.error "Unable to call conversations.list:", body
    ), () ->
      next valid_channels

  else
    # assume room exists for alternate adapters (eg. local development)
    return true
