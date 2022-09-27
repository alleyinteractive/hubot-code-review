fs = require 'fs'
path  = require 'path'
moment = require 'moment'
schedule = require 'node-schedule'

CR_Middleware = require './CodeReviewsMiddleware'
CodeReviewKarma = require './CodeReviewKarma'
sendFancyMessage = require './lib/sendFancyMessage'
msgRoomName = require './lib/msgRoomName'
roomList = require './lib/roomList'
EmojiDataParser = require './lib/EmojiDataParser'
slackTeamId = require './lib/slackTeamId'

class CodeReviews
  constructor: (@robot) ->
    # coffeelint: disable=max_line_length
    @enterprise_github_url_regex = /^(?:https?:\/\/)?([\w.]+)\/?\s*$/i
    @github_url = 'github.com'
    if (process.env.HUBOT_ENTERPRISE_GITHUB_URL)?
      matches = @enterprise_github_url_regex.exec process.env.HUBOT_ENTERPRISE_GITHUB_URL
      if matches
        @github_url = matches[0]
    @pr_url_regex = ///
      ^(https?:\/\/#{@github_url}\/([^\/]+)\/([^\/]+)\/pull\/(\d+))(?:\/files)?\/?(\s+[#|@]?[0-9a-z_-]+)?\s*$
    ///i
    @room_queues = {}
    @current_timeout = null
    @reminder_count = 0
    @emoji_regex = /(\:[a-z0-9_\-\+]+\:)/mi
    @help_text = null
    @help_text_timeout = null

    @garbage_expiration = 1296000000  # 15 days in milliseconds
    @garbage_cron = '0 0 * * *'       # every day at midnight
    @garbage_last_collection = 0      # counter for last collection
    @garbage_job = null

    @karma_monthly_rankings_schedule = '0 0 1 * *'       # midnight on the first of every month
    @karma_monthly_rankings_reset = null

    # Set up middleware
    CR_Middleware @robot

    # CodeReviewKarma functionality for karma_monthly_rankings_reset
    code_review_karma = new CodeReviewKarma @robot

    @robot.brain.on 'loaded', =>
      if @robot.brain.data.code_reviews
        cache = @robot.brain.data.code_reviews
        @room_queues = cache.room_queues || {}
        @set_help_text()
        @collect_garbage()
        unless Object.keys(@room_queues).length is 0
          @queue()

    # Schedule recurring garbage collection
    unless @garbage_job
      @garbage_job = schedule.scheduleJob 'CodeReviews.collect_garbage', @garbage_cron, () =>
        @collect_garbage()

    # Schedule Karma Monthly Score Reset
    # (and notice, if HUBOT_CODE_REVIEW_KARMA_MONTHLY_AWARD_ROOM is set)
    unless (@karma_monthly_rankings_reset)?
      @karma_monthly_rankings_reset = schedule.scheduleJob 'CodeReviewKarma.monthly_rankings', @karma_monthly_rankings_schedule, () ->
        code_review_karma.monthly_rankings()

    # coffeelint: enable=max_line_length

  # Garbage collection, removes all CRs older than @garbage_expiration
  #
  # @return none
  collect_garbage: () ->
    @garbage_last_collection = 0
    # loop through rooms
    if Object.keys(@room_queues).length
      for room, queue of @room_queues
        # loop through queue
        for cr, i in queue by -1
          # remove if cr is expired or if last_updated time is unknown
          if ! cr.last_updated? || (cr.last_updated + @garbage_expiration) < Date.now()
            @remove_from_room room, i
            @garbage_last_collection++
    @robot.logger.info "CodeReviews.collect garbage found #{@garbage_last_collection} items"

  # Update Redis store of CR queues
  #
  # @return none
  update_redis: ->
    @robot.brain.data.code_reviews = { room_queues: @room_queues, help_text: @help_text }

  # Set help text and update Redis with 12 hour lifespan
  #
  # @param string text Text of `help crs` response
  # @return none
  set_help_text: () ->
    commandRe = /^[ \t]*@command[ \t]+(.*)/
    descRe = /^[ \t]*@desc[ \t]+(.*)/
    src = fs.readFileSync path.resolve(__dirname, 'code-reviews.coffee'), { encoding: 'utf8' }
    lines = src.split "\n"
    help_text = ''

    # Parse this format from code-reviews.coffee
    ###
    @command  comand example
    @desc     Command description
    ###
    for line, i in lines
      if commandRe.test(line) and descRe.test(lines[i + 1])
        command = "`#{commandRe.exec(line)[1]}`".replace /hubot./g, @robot.name
        spaces = ' '

        len = 40
        if len > command.length
          while len > command.length
            spaces += ' '
            len--

        desc = descRe.exec(lines[i + 1])[1]
        help_text += "#{command}#{spaces}#{desc}\n"

    # Extra stuff
    help_text += "_Note that some commands require direct @#{@robot.name}," +
    " some don't, and some work either way._\n" +
    "\n\n*Code review statuses*\n" +
    "`new`\t\tPR has just been added to the queue, no one is on it.\n" +
    "`claimed`\tSomeone is on this PR\n" +
    "`approved`\tPR was approved. Requires GitHub webhook.\n" +
    "`merged`\tPR was merged and closed. Requires GitHub webhook.\n" +
    "`closed`\tPR was closed without merging. Requires GitHub webhook.\n"

    @help_text = help_text
    @update_redis()

  # Notify room/user channel of a particular CR
  #
  # @param CodeReview cr CR to update
  # @param String origin_room string of origin room
  # @param String channel_to_notify string of the user/room to notify
  notify_channel: (cr, origin_room, channel_to_notify) ->
    slackTeamId(@robot).then (teamId) ->
      if teamId?
        channel_uri = "slack://app?team=#{teamId}&id=#{channel_to_notify}"
      else
        channel_uri = "https://slack.com/app_redirect?channel=#{origin_room}"

      attachments = []
      attachments.push
        fallback: "#{cr.url} could use your :eyes: Remember to claim it in ##{origin_room}"
        text: "*<#{cr.url}|#{cr.slug}>* could use your :eyes: Remember to claim it" +
        " in <#{channel_uri}|##{origin_room}>"
        mrkdwn_in: ["text"]
        color: "#575757"
      sendFancyMessage @robot, channel_to_notify, attachments

  # Find index of slug in a room's CR queue
  #
  # @param string room Room to look in
  # @param slug Slug to look for
  # @return int|bool Index if found; false if not found
  find_slug_index: (room, slug) ->
    if @room_queues[room] && @room_queues[room].length
      for cr, i in @room_queues[room]
        return i if slug == cr.slug

    # if slug wasn't found return false
    return false

  # Find a slug by fragment in a queue
  #
  # @param string room Room to look in
  # @param string fragment Fragment to look for
  # @param string status Optional CR status to filter by
  # @return array Array of matching CR objects, empty if no matches found
  search_room_by_slug: (room, fragment, status = false) ->
    found = []
    if @room_queues[room] && @room_queues[room].length
      for cr, i in @room_queues[room]
        if cr.slug.indexOf(fragment) > -1
          if ! status
            found.push cr
          else if cr.status is status
            found.push cr
    return found

  # Add a CR to a room queue
  #
  # @param CodeReview cr Code Review object to add
  # @retun none
  add: (cr) ->
    return unless cr.user.room
    @room_queues[cr.user.room] ||= []
    @room_queues[cr.user.room].unshift(cr) if false == @find_slug_index(cr.user.room, cr.slug)
    @update_redis()
    @reminder_count = 0
    @queue()

  # Update metadata of CR passed by reference
  #
  # @param CodeReview cr CR to update
  # @param string status Optional new status of CR
  # @param string reviewer Optional reviewer name for CR
  # @return none
  update_cr: (cr, status = false, reviewer = false) ->
    if status
      cr.status = status
    if reviewer
      cr.reviewer = reviewer
    cr.last_updated = Date.now()
    @update_redis()

  # Reset metadata of CR passed by reference
  #
  # @param CodeReview cr CR to reset
  # @return none
  reset_cr: (cr) ->
    cr.status = 'new'
    cr.reviewer = false
    cr.last_updated = Date.now()
    @update_redis()

  # Update a specific CR to 'claimed' when someone is `on repo/123`
  #
  # @param string room Name of room to look in
  # @param string slug Slug of CR to claim
  # @param string reviewer Name of user who claimed the CR
  # @return CodeReview|bool CR object, or false if slug was not found or already claimed
  claim_by_slug: (room, slug, reviewer) ->
    i = @find_slug_index room, slug
    if i != false && @room_queues[room][i].status == 'new'
      @update_cr @room_queues[room][i], 'claimed', reviewer
      return @room_queues[room][i]
    else
      return false

  # Update earliest added unclaimed CR when someone is `on it`
  #
  # @param string room Name of room to look in
  # @param string reviewer Name of user who claimed the CR
  # @return CodeReview|bool CR object, or false if queue has no unclaimed CRs
  claim_first: (room, reviewer) ->
    # return false if queue is empty
    unless @room_queues[room] && @room_queues[room].length
      return false
    # look for earliest added unclaimed CR
    for cr, i in @room_queues[room] by -1
      if cr.status == 'new'
        @update_cr @room_queues[room][i], 'claimed', reviewer
        return @room_queues[room][i]

    # return false if all CRs have been spoken for
    return false

  # Remove most recently added *unclaimed* CR from a room
  #
  # @param string room Room to look in
  # @return CodeReview|bool CR object that was removed, or false if queue has no unclaimed CRs
  remove_last_new: (room) ->
    unless room and @room_queues[room] and @room_queues[room].length
      return false
    # find first new CR in room and remove it
    for cr, i in @room_queues[room]
      if cr.status == 'new'
        return @remove_from_room room, i
    # return false if no new prs
    return false

  # Remove a CR with *any status* from a room
  #
  # @param string room Room to look in
  # @param string slug Slug to remove
  # @return CodeReview|bool CR object that was removed, or false if slug was not found
  remove_by_slug: (room, slug) ->
    return unless room
    i = @find_slug_index(room, slug)
    unless i is false
      return @remove_from_room room, i
    return false

  # Remove a CR from a room by index
  #
  # @param string room Room to look in
  # @param int index Index to remove from queue
  # @return CodeReview|bool CR object that was removed, or false if room or index was invalid
  remove_from_room: (room, index) ->
    # make sure the queue exists and is longer than the index we're looking for
    unless @room_queues[room] && @room_queues[room].length > index
      return false

    removed = @room_queues[room].splice index, 1
    delete @room_queues[room] if @room_queues[room].length is 0
    @update_redis()
    @check_queue()
    return removed.pop()

  # Clear the reminder timeout if there are no CR queues in any rooms
  #
  # @return none
  check_queue: ->
    if Object.keys(@room_queues).length is 0
      clearTimeout @current_timeout if @current_timeout

  # Reset all room queues
  #
  # @return none
  flush_queues: ->
    @room_queues = {}
    @update_redis()
    clearTimeout @current_timeout if @current_timeout

  # Return a list of CRs in a queue
  #
  # @parm string room Name of room
  # @param bool verbose Whether to return a message when requested list is empty
  # @param string status CR status to list,
  #     can be 'new', 'all', 'claimed', 'approved', 'closed', 'merged'
  # @return hash reviews with contents:
  #     reviews["pretext"]{string} and reviews["cr"]{array of strings}
  list: (room, verbose = false, status = 'new') ->
    # Look for CRs with the correct status
    reviews = []
    reviews["cr"] = []
    if room and @room_queues[room] and @room_queues[room].length > 0
      for cr in @room_queues[room]
        if cr.status == status || status == 'all'
          fromNowLabel = if cr.status is 'new' then 'added' else cr.status
          fromNowLabel += ' '
          timeString = '(_' + fromNowLabel + moment(cr.last_updated).fromNow() + '_)'
          if (cr.extra_info? && cr.extra_info.length != 0)
            extra_info_text = "#{cr.extra_info} " + timeString
          else
            extra_info_text = timeString
          reviews["cr"].push "*<#{cr.url}|#{cr.slug}>* #{extra_info_text}"
    # Return a list of the CRs we found
    if reviews["cr"].length != 0
      if status == 'new'
        reviews["pretext"] = "There are pending code reviews. Any takers?"
      else
        reviews["pretext"] = "Here's a list of " + status + " code reviews for you."
    # If we didn't find any, say so
    else if verbose == true
      if status == 'new' || status == 'all'
        status = 'pending'
      reviews["pretext"] = "There are no " + status + " code reviews for this room."
    return reviews


  # Send a fancy message to a room with CRs matching the status
  #
  # @parm string room Name of room
  # @param bool verbose Whether to send a message when requested list is empty
  # @param string status CR status to list,
  #     can be 'new', 'all', 'claimed', 'approved', 'closed', 'merged'
  # @return none
  send_list: (room, verbose = false, status = 'new') ->
    # Look for CRs with the correct status
    message = @list room, verbose, status
    intro_text = message["pretext"]
    if message["cr"].length != 0 or verbose is true
      # To handle the special slack case of only showing 5 lines in an attachment,
      # we break every CR into its own attachment
      attachments = []
      for index, message of message["cr"]
        if /day[s]? ago/.test(message)
          color = "#4c0000" # blackish/red
        else if /hour[s]? ago/.test(message)
          color = "#FF0000" #red
        else if /[3-5][0-9] minutes ago/.test(message)
          color = "#ffb732" #yellowy/orange
        else
          color = "#cceadb" # triadic green
        attachments.push
          fallback: message
          text: message
          mrkdwn_in: ["text"]
          color: color
      # Send the formatted slack message with attachments
      sendFancyMessage @robot, room, attachments, intro_text

  # Recurring reminder when there are *unclaimed* CRs
  #
  # @param int nag_dealy Optional reminder interval in milliseconds,
  #     defaults to 5min, but can be overridden with HUBOT_CODE_REVIEW_REMINDER_MINUTES
  #     Note that the logical maximum is 60m due to hourly reminders
  # @return none
  queue: (nag_delay = process.env.HUBOT_CODE_REVIEW_REMINDER_MINUTES || 5) ->
    minutes = nag_delay * @reminder_count

    clearTimeout @current_timeout if @current_timeout
    if Object.keys(@room_queues).length > 0
      rooms_have_new_crs = false

      # Get roomList to exclude non-existent or newly archived
      #  rooms (unless we're not using Slack)
      roomList @robot, (valid_rooms) =>
        trigger = =>
          for room of @room_queues
            if room in valid_rooms or
            @robot.adapterName isnt "slack"
              active_crs = @list room
              if active_crs["cr"].length > 0
                rooms_have_new_crs = true
                @send_list room
                if minutes >= 60 and # Equal to or longer than one hour
                minutes < 120 and # Less than 2 hours
                (minutes %% 60) < nag_delay # Is the first occurrence after an hour
                  @robot.send { room: room }, "@here: :siren: This queue has been active for " +
                  "an hour, someone get on this. :siren:\n_Reminding hourly from now on_"
                else if minutes > 60
                  @robot.send { room: room }, "This is an hourly reminder."
            else
              # If room doesn't exist, clear out the queue for it
              @robot.logger.warning "Unable to find room #{room}; removing from room_queue"
              delete @room_queues[room]
              @update_redis()

          @reminder_count++ unless rooms_have_new_crs is false
          if minutes >= 60
            nag_delay = 60 # set to one hour intervals
          @queue(nag_delay)
        @current_timeout = setTimeout(trigger, nag_delay * 60000) # milliseconds in a minute

  # Get CR slug from PR URL regex matches
  #
  # @param array matches Matches array from RegExp.exec()
  # @return string Slug for CR queue
  matches_to_slug: (matches) ->
    if ! matches || matches.length < 5
      return null
    owner = matches[2]
    repo = matches[3]
    pr = matches[4]
    if 'alleyinteractive' != owner
      repo = owner + '/' + repo
    return repo + '/' + pr

  # Return github files api request url string from PR url
  #
  # @param string url PR url
  # @return string github_url for CR queue
  url_to_github_api_url_files: (url) ->
    matches = @pr_url_regex.exec url
    if ! matches || matches.length < 5
      return null
    owner = matches[2]
    repo = matches[3]
    pr = matches[4]
    @github_api_url = 'api.github.com'
    if @github_url != 'github.com'
      @github_api_url = @github_url + '/api/v3'
    return 'https://' + @github_api_url + '/repos/' + owner + '/' +
    repo + '/pulls/' + pr + '/files?per_page=100'

  # Return github pr api request url string from PR url
  #
  # @param string url PR url
  # @return string github_url for CR queue
  url_to_github_api_url_pr: (url) ->
    matches = @pr_url_regex.exec url
    if ! matches || matches.length < 5
      return null
    owner = matches[2]
    repo = matches[3]
    pr = matches[4]

    @github_api_url = 'api.github.com'
    if @github_url != 'github.com'
      @github_api_url = @github_url + '/api/v3'
    return 'https://' + @github_api_url + '/repos/' + owner + '/' +
    repo + '/pulls/' + pr

  # Send a confirmation message to msg for cr
  #
  # @param cr CodeReview code review to add
  # @param msg slack msg object to respond to
  # @param notification_string string supplied in PR submission to notifiy channel|name
  # @return none
  send_submission_confirmation: (cr, msg, notification_string = null) ->
    # If our submitter provided a notification individual/channel notify them
    if (notification_string)? and notification_string.length
      notify_name = notification_string[0...] || null
    if (notify_name)?
      msgRoomName msg, (room_name) =>
        @notify_channel(cr, room_name, notify_name)

    # If our submitter provided a notification individual/channel, say so.
    if (notify_name)?
      msg.send "*#{cr.slug}* is now in the code review queue," +
      " and #{notify_name} has been notified."
    else
      msg.send "*#{cr.slug}* is now in the code review queue." +
      " Let me know if anyone starts reviewing this."

  # Add a cr with any GitHub file type information and send applicable notifications
  #
  # @param cr CodeReview code review object to add
  # @param msg slack msg object to respond to
  # @param notification_string string supplied in PR submission to notifiy channel|name
  # @return none
  add_cr_with_extra_info: (cr, msg, notification_string = null) ->
    if (process.env.HUBOT_GITHUB_TOKEN)? # If we have GitHub creds...
      github = require('githubot')
      github_api_files = @url_to_github_api_url_files(cr.url)
      github_api_pr = @url_to_github_api_url_pr(cr.url)
      github.get (github_api_files), (files) =>
        files_string = ( @pr_file_types files ) || ''
        github.get (github_api_pr), (pr) =>
          # Populate extra PR metadata based on HUBOT_CODE_REVIEW_META
          cr.extra_info = switch process.env.HUBOT_CODE_REVIEW_META
            when 'both' then "*_#{pr.title}_*\n#{files_string}"
            when 'files' then files_string
            when 'title' then "*_#{pr.title}_*\n"
            when 'none' then ''
            else files_string # Default to files behavior pre 1.0

          if (pr)? and (pr.user)? and (pr.user.login)?
            cr.github_pr_submitter = pr.user.login
          @add cr
          @send_submission_confirmation(cr, msg, notification_string)

      github.handleErrors (response) =>
        @robot.logger.info "Unable to connect to GitHub's API for #{cr.slug}." +
        " Ensure you have access. Response: #{response.statusCode}"
        @add cr
        @send_submission_confirmation(cr, msg, notification_string)

    else # No GitHub credentials... just add and move on
      @add cr
      @send_submission_confirmation(cr, msg, notification_string)

  # Return a list of file types and counts (string) from files array
  # returned in GitHub api request (limited to first page, ie: 100 files)
  #
  # @param array files Files array returned from GitHub api
  # @return string file_types_string for use in CR extra_info
  pr_file_types: (files) ->
    if ! files
      return null
    file_types_string = ""
    file_types = []
    counts = {}
    other_file_types = {}
    for item in files
      file_types.push(item.filename.replace /.*?\.((?:(?:min|bundle)\.)?[a-z]+$)/, "$1")
    for type in file_types
      if process.env.HUBOT_CODE_REVIEW_FILE_EXTENSIONS
        extensions_we_care_about = process.env.HUBOT_CODE_REVIEW_FILE_EXTENSIONS.split(' ')
      else
        extensions_we_care_about =
        [
          'coffee',
          'css',
          'html',
          'js',
          'jsx',
          'md',
          'php',
          'rb',
          'scss',
          'sh',
          'txt',
          'yml'
        ]
      # When it's a file type we care about, count it specifically
      if extensions_we_care_about.includes(type)
        if counts["#{type}"]?
          counts["#{type}"] = counts["#{type}"] + 1
        else
          counts["#{type}"] = 1
      else
        if other_file_types["other"]?
          other_file_types["other"] = other_file_types["other"] + 1
        else
          other_file_types["other"] = 1
    # Format and append the counts to the file_types_string
    for k, v of counts
      file_types_string += " `#{k} (#{v})`"
    for k, v of other_file_types
      file_types_string += " `#{k} (#{v})`"
    return file_types_string

  # Update CR status and notify submitter when PR has been
  # approved via GitHub
  #
  # @param string url URL of PR on GitHub
  # @param string commenter GitHub username of person who approved
  # @param string string comment Full text of comment
  # @return none
  approve_cr_by_url: (url, commenter, comment) ->
    approved = @update_cr_by_url url, 'approved'
    unless approved.length
      return
    message = commenter + ' approved ' + url + ":\n" + comment

    for cr in approved
      # send DM to Slack user who added the PR to the queue (not the Github user who opened the PR)
      @robot.messageRoom '@' + cr.user.name, 'hey @' + cr.user.name + '! ' + message

  # Notify submitter when PR has not been approved
  #
  # @param string url URL of PR on GitHub
  # @param string commenter GitHub username of person who approved
  # @param string comment Full text of comment
  # @return none
  comment_cr_by_url: (url, commenter, comment) ->
    cr_list = @update_cr_by_url url
    unless cr_list.length
      return
    message = commenter + ' commented on ' + url + ":\n" + comment

    for cr in cr_list
      # If the comment wasn't from the Github user who opened the PR
      if cr.github_pr_submitter isnt commenter
        # send DM to Slack user who added the PR to the queue
        @robot.messageRoom '@' + cr.user.name, 'hey @' + cr.user.name + ', ' + message

  # Notify submitter when PR review has been dismissed
  #
  # @param string url URL of PR on GitHub
  # @param string reviewer GitHub username of person who created review
  # @return none
  dismiss_cr_by_url: (url, reviewer) ->
    cr_list = @update_cr_by_url url
    unless cr_list.length
      return
    message = "#{reviewer}'s review for #{url} was *dismissed*\n\n" +
              "Consider requesting a new review or resetting the PR if needed"

    for cr in cr_list
      # If the review wasn't from the Github user who opened the PR
      if cr.github_pr_submitter isnt reviewer
        # send DM to Slack user who added the PR to the queue
        @robot.messageRoom '@' + cr.user.name, 'hey @' + cr.user.name + ', ' + message


  # Find and update CRs across all rooms that match a URL
  # @param string url URL of GitHub PR
  # @param string|bool status Optional new status of CR
  # @param string|bool reviwer Optional name of reviewer
  # @return array Array of updated CRs; may be empty array if URL not found
  update_cr_by_url: (url, status = false, reviewer = false) ->
    slug = @matches_to_slug(@pr_url_regex.exec url)
    crs_found = []
    for room, queue of @room_queues
      i = @find_slug_index room, slug
      unless i == false
        @update_cr @room_queues[room][i], status, reviewer
        crs_found.push @room_queues[room][i]
        # continue loop in case same PR is in multiple rooms
    return crs_found

  # Selectively update local cr status when a merge, close, or PR rejection event happens on GitHub
  # @param string url URL of GitHub PR
  # @param string|bool status Status of pull request on Github, either:
  #   'merged', 'closed', or 'changes_requested'
  # @return array Array of updated CRs; may be empty array if URL not found
  handle_close: (url, status) ->
    slug = @matches_to_slug(@pr_url_regex.exec url)
    crs_found = []
    for room, queue of @room_queues
      i = @find_slug_index room, slug
      unless i == false
        cr = @room_queues[room][i]
        messageReceiver = cr.reviewer
        # Handle merged
        if status is "merged"
          switch cr.status
            # PR was merged before anyone is on it
            when "new"
              newStatus = false
              message = "*#{cr.slug}* has been merged but still needs to be reviewed, just fyi."
            # PR was merged after someone claimed it but before it was approved
            when "claimed"
              message = "Hey @#{cr.reviewer}, *#{cr.slug}* has been merged" +
              " but you should keep reviewing."
              newStatus = false
            else
              newStatus = status
              message = false
        else if status is "closed"
          switch cr.status
            # PR was closed before anyone claimed it
            when "new"
              newStatus = false
              message = "Hey @#{cr.user.name}, looks like *#{cr.slug}* was closed on GitHub." +
              " Say `ignore #{cr.slug}` to remove it from the queue."
              messageReceiver = cr.user.name
            # PR was closed after someone claimed it but before it was approved
            when "claimed"
              newStatus = false
              message = "Hey @#{cr.reviewer}, *#{cr.slug}* was closed on GitHub." +
              " Maybe ask @#{cr.user.name} if it still needs to be reviewed."
            else
              newStatus = status
              message = false
        else if status is "changes_requested"
          # PR was reviewed with changes_requested before anyone claimed it in-channel
          newStatus = 'closed'
          message = "Hey @#{cr.user.name}, looks like the PR for *#{cr.slug}* over in" +
          " <https://slack.com/app_redirect?channel=#{room}|##{room}> has some changes" +
          " requested on GitHub. I've removed `#{cr.slug}` from the queue,  but you should" +
          " add it back with a `hubot reset #{cr.slug}` when you need another review."
          console.log(message)
          messageReceiver = cr.user.name

        # update CR, send message to room, add to results
        if newStatus
          @update_cr @room_queues[room][i], newStatus
        if message
          @robot.messageRoom '@' + messageReceiver, message
        crs_found.push @room_queues[room][i]
    # return results
    return crs_found

  # General stats about CR queues, list available rooms
  # @return string Message to send back
  queues_debug_stats: () ->
    response = ["Here's a summary of all code review queues:\n"]
    for room, queue of @room_queues
      response.push "--- ##{room} ---"
      for cr, i in queue
        reviewer = cr.reviewer || 'n/a'
        lastUpdatedStr = new Date(cr.last_updated).toString()
        response.push "#{cr.slug}\t\t#{cr.status}\t\t#{reviewer}\t\t#{lastUpdatedStr}"
    response.push "\nFor more detailed info, specify a room like" +
    " `hubot: debug the cr queue for #room_name`"
    return response.join("\n")

  # Return JSON for specific room's CR queue
  # @param string room Chat room name
  # @return string JSON string of room's data, or message if room not found
  queues_debug_room: (room) ->
    if Object.keys(@room_queues).indexOf(room) is -1
      return "Sorry, I couldn't find a code review queue for #{room}."

    output = []
    for cr in @room_queues[room]
      # make copy of CR object then delete Slack-specific info
      # because we don't use it and it makes the debug output hard to read
      crCopy = {}
      for own key, value of cr
        crCopy[key] = value
      if crCopy.user.slack
        delete crCopy.user.slack
      output.push crCopy

    return JSON.stringify output, null, '  '

  # Test if string contains Unicode emoji char
  # @param string str String to test
  # @return bool
  emoji_unicode_test: (str) ->
    unless @emojiDataParser
      @emojiDataParser = new EmojiDataParser
    return @emojiDataParser.testString str

module.exports = CodeReviews
