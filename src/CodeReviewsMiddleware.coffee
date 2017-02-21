module.exports = (robot) ->
  robot.listenerMiddleware (context, next, done) ->
    unless context.response.message.text and context.response.message.text.indexOf('help crs') isnt -1
      next()
    else
      # disable default `hubot help <query>` response when requesting `hubot help crs`
      regex = context.listener.regex.toString()
      if regex.indexOf('help') > -1 and regex.indexOf('help crs') is -1
        done()
      else
        next()