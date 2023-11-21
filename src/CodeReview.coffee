class CodeReview
  constructor: (
  @user,
  @slug,
  @url,
  @room = @user.room,
  @channel_id = @user.room,
  @status = 'new',
  @reviewer = false) ->
    @last_updated = Date.now()
    @extra_info = ""
    @github_pr_submitter = @user

module.exports = CodeReview