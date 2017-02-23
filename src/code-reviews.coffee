# Description:
#   Manage code review reminders
#
# Configuration:
#   HUBOT_GITHUB_TOKEN
#
# Commands:
#   hubot help crs - display code review help

CodeReviews = require './CodeReviews'
CodeReview = require './CodeReview'
CodeReviewKarma = require './CodeReviewKarma'
msgRoomName = require './lib/msgRoomName'

module.exports = (robot) ->

  code_review_karma = new CodeReviewKarma robot
  code_reviews = new CodeReviews robot

  enqueue_code_review = (msg) ->
    url = msg.match[1]
    slug = code_reviews.matches_to_slug msg.match
    if slug
      cr = new CodeReview msg.message.user, slug, url
      # Specific override for human readable cr.user.room
      cr.user.room = msgRoomName(msg)
      found = code_reviews.find_slug_index msgRoomName(msg), slug
      if found is false
        # 'Take' a code review for karma
        code_review_karma.incr_score msg.message.user.name, 'take'

        if (msg.match[5])? and msg.match[5].length
          notification_string = msg.match[5].replace /^\s+|\s+$/g, ""
        else
          notification_string = null
        # Add any extra info to the cr, seng extra notifications, and add it to the room_queue
        code_reviews.add_cr_with_extra_info(cr, msg, notification_string)

      else
        if code_reviews.room_queues[msgRoomName(msg)][found].status != 'new'
          statusMsg = "#{code_reviews.room_queues[msgRoomName(msg)][found].status}"
        else
          statusMsg = 'added'
        if code_reviews.room_queues[msgRoomName(msg)][found].reviewer
          reviewerMsg = " and was #{statusMsg} by" +
          " @#{code_reviews.room_queues[msgRoomName(msg)][found].reviewer}"
        else
          reviewerMsg = ''
        msg.send "*#{slug}* is already in the queue#{reviewerMsg}"
    else
      msg.send "Error adding #{url} to queue"

  # Respond to message with matching slug names
  #
  # @param slugs matching slugs
  # @param msg message to reply to
  # @return none
  send_be_more_specific = (slugs, msg) ->
    # Bold the slugs
    slugs = ("`#{slug}`" for slug in slugs)
    lastSlug = 'or ' + slugs.pop()
    slugs.push lastSlug
    msg.send "You're gonna have to be more specific: " + slugs.join(', ') + '?'

  # Return a single matching CR for slug match or alert the user to match status
  #
  # @param slugs matching slugs
  # @param msg message to reply to
  # @return none
  single_matching_cr = (slug_to_search_for, msg, status = false, no_reply = false) ->
    # search for matching slugs whether a fragment or full slug is provided
    found_crs = code_reviews.search_room_by_slug msgRoomName(msg), slug_to_search_for, status

    # no matches
    if found_crs.length is 0
      unless no_reply
        status_prs = if status then "#{status} " else ''
        msg.send "Sorry, I couldn't find any #{status_prs}PRs" +
        " in this room matching `#{slug_to_search_for}`."
      return
    # multiple matches
    else if found_crs.length > 1
      foundSlugs = for cr in found_crs
        cr.slug
      unless no_reply
        send_be_more_specific foundSlugs, msg
      return
    # There's a single matching slug in this room to redo
    else
      return found_crs[0]

  dequeue_code_review = (cr, reviewer, msg) ->
    if cr and cr.slug
      code_review_karma.incr_score reviewer, 'give'
      msg.send "Thanks, #{reviewer}! I removed *#{cr.slug}* from the code review queue."

  ###
  @command  hubot: help crs
  @desc     Display help docs for code review system
  ###
  robot.respond /help crs(?: --(flush))?$/i, id: 'crs.help', (msg) ->
    if ! code_reviews.help_text or (msg.match[1] and msg.match[1].toLowerCase() is 'flush')
      code_reviews.set_help_text()

    msg.send code_reviews.help_text

  ###
  @command  {GitHub pull request URL} [@user]
  @desc     Add PR to queue and (optionally) notify @user or #channel
  ###
  robot.hear code_reviews.pr_url_regex, enqueue_code_review

  ###
  @command  [hubot: ]on it
  @desc     Claim the oldest _new_ PR in the queue
  @command  [hubot: ]userName is on it
  @desc     Tell hubot that userName has claimed the oldest _new_ PR in the queue
  ###
  # Claim first PR in queue by directly addressing hubot
  robot.respond /(?:([-_a-z0-9]+) is )?on it/i, (msg) ->
    reviewer = msg.match[1] or msg.message.user.name
    cr = code_reviews.claim_first msgRoomName(msg), reviewer
    dequeue_code_review cr, reviewer, msg

  # Claim first PR in queue wihout directly addressing hubot
  # Note the this is a `hear` listener and previous is a `respond`
  robot.hear /^(?:([-_a-z0-9]+) is )?on it$/, (msg) ->
    reviewer = msg.match[1] or msg.message.user.name
    cr = code_reviews.claim_first msgRoomName(msg), reviewer
    dequeue_code_review cr, reviewer, msg

  ###
  @command  on *
  @desc     Claim all _new_ PRs
  ###
  robot.hear /^on \*$/i, (msg) ->
    msg.emote ":tornado2:"
    reviewer = msg.message.user.name
    until false is cr = code_reviews.claim_first msgRoomName(msg), reviewer
      dequeue_code_review cr, reviewer, msg

  ###
  @command [userName is ]on cool-repo/123
  @desc    Claim `cool-repo/123` if no one else has claimed it
  @command [userName is ]on cool
  @desc    Claim a _new_ PR whose slug matches `cool`
  ###
  robot.hear /^(?:([-_a-z0-9]+) is )?(?:on) ([-_\/a-z0-9]+|\d+|[-_\/a-z0-9]+\/\d+)$/i, (msg) ->
    reviewer = msg.match[1] or msg.message.user.name
    slug = msg.match[2]
    return if slug.toLowerCase() is 'it'

    unclaimed_cr = single_matching_cr(slug, msg, status = "new")
    if (unclaimed_cr)?
      code_reviews.claim_by_slug msgRoomName(msg), unclaimed_cr.slug, reviewer
      dequeue_code_review unclaimed_cr, reviewer, msg

    # none of the matches have "new" status
    else
      cr = single_matching_cr(slug, msg, status = false, no_output = true)
      # When someone attempts to claim a PR
      # that was already reviewed, merged, or closed outside of the queue
      if (cr)?
        response = "It looks like *#{cr.slug}* (@#{cr.user.name}) has already been #{cr.status}"
        msg.send response

  ###
  @command (nm|ignore) cool-repo/123
  @desc    Delete `cool-repo/123` from queue regardless of status
  @command (nm|ignore) cool
  @desc    Delete most recently added PR whose slug matches `cool` regardless of status
  ###
  robot.hear /^(?:nm|ignore) ([-_\/a-z0-9]+|\d+|[-_\/a-z0-9]+\/\d+)$/i, (msg) ->
    slug = msg.match[1]
    return if slug.toLowerCase() is 'it'

    found_ignore_cr = single_matching_cr(slug, msg)
    if (found_ignore_cr)?
      code_reviews.remove_by_slug msgRoomName(msg), found_ignore_cr.slug
      #decrement scores
      code_review_karma.decr_score found_ignore_cr.user.name, 'take'
      if found_ignore_cr.reviewer
        code_review_karma.decr_score found_ignore_cr.reviewer, 'give'
      msg.send "Sorry for eavesdropping. I removed *#{found_ignore_cr.slug}* from the queue."
      return

  ###
  @command hubot: (nm|ignore)
  @desc    Delete most recently added PR from the queue regardless of status
  ###
  robot.respond /(?:\s*)(?:nm|ignore)(?:\s*)$/i, (msg) ->
    cr = code_reviews.remove_last_new msgRoomName(msg)
    if cr and cr.slug
      code_review_karma.decr_score cr.user.name, 'take'
      if cr.reviewer
        code_review_karma.decr_score cr.reviewer, 'give'
      msg.send "Sorry for eavesdropping. I removed *#{cr.slug}* from the queue."
    else
      msg.send "There might not be a new PR to remove. Try specifying a slug."

  ###
  @command hubot: redo cool-repo/123
  @desc    Allow another review _without_ decrementing previous reviewer's score
  ###
  robot.respond /(?:redo)(?: ([-_\/a-z0-9]+|\d+|[-_\/a-z0-9]+\/\d+))/i, (msg) ->
    found_redo_cr = single_matching_cr(msg.match[1], msg)
    if (found_redo_cr)?
      index = code_reviews.find_slug_index msgRoomName(msg), found_redo_cr.slug
      code_reviews.reset_cr code_reviews.room_queues[msgRoomName(msg)][index]
      msg.send "You got it, #{found_redo_cr.slug} is ready for a new review."

  ###
  @command hubot: (unclaim|reset) cool-repo/123
  @desc    Reset CR status to new/unclaimed _and_ decrement reviewer's score
  ###
  robot.respond /(unclaim|reset)(?: ([-_\/a-z0-9]+|\d+|[-_\/a-z0-9]+\/\d+))?/i, (msg) ->
    found_reset_cr = single_matching_cr(msg.match[2], msg)
    if (found_reset_cr)?
      # decrement reviewers CR score
      if found_reset_cr.reviewer
        code_review_karma.decr_score found_reset_cr.reviewer, 'give'

      index = code_reviews.find_slug_index msgRoomName(msg), found_reset_cr.slug
      code_reviews.reset_cr code_reviews.room_queues[msgRoomName(msg)][index]
      msg.match[1] += 'ed' if msg.match[1].toLowerCase() is 'unclaim'
      msg.send "You got it, I've #{msg.match[1]} *#{found_reset_cr.slug}* in the queue."

  ###
  @command hubot: list crs
  @desc    List all _unclaimed_ CRs in the queue
  @command hubot: list [status] crs
  @desc    List CRs with matching optional status
  ###
  robot.respond /list(?: (all|new|claimed|approved|closed|merged))? CRs/i, (msg) ->
    status = msg.match[1] || 'new'
    code_reviews.send_list msgRoomName(msg), true, status

  # Flush all CRs in all rooms
  robot.respond /flush the cr queue, really really/i, (msg) ->
    code_reviews.flush_queues()
    msg.send "This house is clear"

  # Flush all the scores
  robot.respond /flush cr scores, really really/i, (msg) ->
    code_reviews.flush_scores()
    msg.send "This house is clear"

  # Display JSON of all CR queues
  robot.respond /debug the cr queue ?(?:for #?([a-z0-9\-_]+))?$/i, (msg) ->
    if !msg.match[1]
      msg.send code_reviews.queues_debug_stats()
    else
      msg.send code_reviews.queues_debug_room(msg.match[1])

  # Mark a CR as approved or closed when webhook received from GitHub
  robot.router.post '/hubot/cr-comment', (req, res) ->
    # check header
    unless req.headers['x-github-event']
      res.statusCode = 400
      res.send 'x-github-event is required'
      return

    # Check if PR was approved (via emoji in issue_comment body)
    if req.headers['x-github-event'] is 'issue_comment'
      if ((process.env.HUBOT_CODE_REVIEW_EMOJI_APPROVE?) and
      process.env.HUBOT_CODE_REVIEW_EMOJI_APPROVE)
        if code_reviews.emoji_regex.test(req.body.comment.body) or
        code_reviews.emoji_unicode_test(req.body.comment.body)
          code_reviews.approve_cr_by_url(
            req.body.issue.html_url,
            req.body.comment.user.login,
            req.body.comment.body
          )
          response = "issue_comment approved #{req.body.issue.html_url}"
        else
          code_reviews.comment_cr_by_url(
            req.body.issue.html_url,
            req.body.comment.user.login,
            req.body.comment.body
          )
          response = "issue_comment did not yet approve #{req.body.issue.html_url}"
      else
        code_reviews.comment_cr_by_url(
          req.body.issue.html_url,
          req.body.comment.user.login,
          req.body.comment.body
        )
        response = "issue_comment did not yet approve #{req.body.issue.html_url}"
    # Check if PR was merged or closed
    else if req.headers['x-github-event'] is 'pull_request'
      if req.body.action is 'closed'
        # update CRs
        status = if req.body.pull_request.merged then 'merged' else 'closed'
        updated = code_reviews.handle_merge_close req.body.pull_request.html_url, status
        # build response message
        if updated.length
          response = "set status of #{updated[0].slug} to "
          rooms = for cr in updated
            "#{cr.status} in #{cr.user.room}"
          response += rooms.join(', ')
        else
          response = "#{req.body.pull_request.html_url} not found in any queue"
      else
        response = "#{req.body.pull_request.html_url} is still open"

    # Check if PR was approved via GitHub's Pull Request Review
    else if req.headers['x-github-event'] is 'pull_request_review'
      if req.body.review.state is 'approved'
        response = "pull_request_review approved #{req.body.pull_request.html_url}"
        code_reviews.approve_cr_by_url(
          req.body.pull_request.html_url,
          req.body.review.user.login,
          req.body.review.body
        )
      else
        code_reviews.comment_cr_by_url(
          req.body.pull_request.html_url,
          req.body.review.user.login,
          req.body.review.body
        )
        response = "pull_request_review not yet approved #{req.body.pull_request.html_url}"
    else
      res.statusCode = 400
      response = "invalid x-github-event #{req.headers['x-github-event']}"

    # useful for testing
    res.send response

  # return for use in unit tests
  return code_reviews
