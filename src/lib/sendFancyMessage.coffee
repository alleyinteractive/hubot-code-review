  # Send Slack formatted message
  # @param robot
  # @param room String name of room
  # @param attachments https://api.slack.com/docs/message-attachments
  # @return none
module.exports = (robot, room, attachments, text) ->
  if robot.adapterName isnt "slack"
    fallback_text = text || ''
    for index, attachment of attachments
      fallback_text += "\n#{attachment.fallback}"
    robot.messageRoom room, fallback_text.replace(/\n$/, "")
  else
    # Strip any preceeding # from room name
    room_name = room.replace /^#/g, ""
    # Working around a Slack for Android bug 2016-08-30 by supplying
    # text attribute outside of attachment array to allow previews
    if text?
      try
        robot.send { room: room_name },
          as_user: true
          channel: room_name
          text: text
          attachments: attachments
      catch sendErr
        robot.logger.error "Unable to send message to room: #{room}: ", sendErr, attachments
    else
      try
        robot.send { room: room_name },
          as_user: true
          channel: room_name
          attachments: attachments
      catch sendErr
        robot.logger.error "Unable to send message to room: #{room}: ", sendErr, attachments
