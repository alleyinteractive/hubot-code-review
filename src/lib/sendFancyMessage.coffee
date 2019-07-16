  # Send Slack formatted message
  # @param robot
  # @param room String name of room
  # @param attachments https://api.slack.com/docs/message-attachments
  # @return none

async = require 'async'

module.exports = (robot, room, attachments, text) ->
  if robot.adapterName isnt "slack"
    fallback_text = text || ''
    for index, attachment of attachments
      fallback_text += "\n#{attachment.fallback}"
    robot.messageRoom room, fallback_text.replace(/\n$/, "")
  else
    if text?
      try
        robot.send { room: room },
          as_user: true
          channel: room
          text: text
          attachments: attachments
      catch sendErr
        robot.logger.error("Unable to send message #{text} to room: #{room}: ", sendErr)
    else
      try
        robot.send { room: room },
          as_user: true
          channel: room
          attachments: attachments
      catch sendErr
        robot.logger.error("Unable to send message to room: #{room}: ", sendErr)
