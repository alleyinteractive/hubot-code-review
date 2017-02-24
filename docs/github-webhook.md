GitHub webhook instructions for hubot-code-review
===================

Adding a webhook from GitHub makes `hubot-code-review` even better. With the hook in place,
Hubot can DM you when your PR has been approved or when someone has commented
on your PR.

## Organization or Repository Webhook?

While you can add webhooks to individual repositories, adding an organization-wide hook is
a convenient way to include all repositories (current and future) in your organization.

![](/docs/images/organization-webhook.png)

## Webhook specifics:

*Payload Url:*
Hubot will have a listener at `{BASEURL}/hubot/hubot-code-review` where `{BASEURL}` is your
Hubot URL (on Heroku, this might be the `HEROKU_URL` environmental variable).

*Content Type:*
This should be set to `application/json`

![](/docs/images/webhook-settings.png)

*Which Events...:*

We need to create a hook to the above url that passes along the following events:

- Issue Comment
- Pull Request
- Pull Request Review

![](/docs/images/webhook-events.png)


## What now?

You're set! This organization (or repository) will tell `hubot-code-review` whenever there
are substantive changes to the PR status!

If you haven't done so already, configure [`HUBOT_GITHUB_TOKEN` for hubot-code-review](/docs/HUBOT_GITHUB_TOKEN.md)
