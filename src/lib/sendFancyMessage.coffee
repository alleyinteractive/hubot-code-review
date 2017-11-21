  # Send Slack formatted message
  # @param robot
  # @param room String name of room
  # @param attachments https://api.slack.com/docs/message-attachments
  # @return none
module.exports = (robot, room, attachments, text) ->
   if robot.adapterName is "slack"
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
   else if robot.adapterName is "flowdock"
      robot.send { room: room },
         text: text
         attachments: attachments
   else
      fallback_text = text || ''
      for index, attachment of attachments
      fallback_text += "\n#{attachment.fallback}"
      robot.messageRoom room, fallback_text.replace(/\n$/, "")