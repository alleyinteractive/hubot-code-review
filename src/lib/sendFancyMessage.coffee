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
    # Working around a Slack for Android bug 2016-08-30 by supplying
    # text attribute outside of attachment array to allow previews
    if text?
      robot.send { room: room },
        as_user: true
        channel: room
        text: text
        attachments: attachments
    else
      robot.send { room: room },
        as_user: true
        channel: room
        attachments: attachments