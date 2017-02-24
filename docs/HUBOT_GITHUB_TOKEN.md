`HUBOT_GITHUB_TOKEN` for hubot-code-review
===================

Adding a `HUBOT_GITHUB_TOKEN` environmental variable to hubot-code-review allows Hubot to
query GitHub for file type information when reporting the PR back to the room.

![](/docs/images/remind-pr.png)

## Which GitHub account should create the 'Personal Access Token'?

Some organizations might already have a dedicated user account for operational/deployment
purposes. Whichever account you use to [create the access token](https://help.github.com/articles/creating-an-access-token-for-command-line-use/) should have access to the repositories
you want to enable the filetype checking for.

## What scope does the HUBOT_GITHUB_TOKEN need?

We'll need the `repo` scope.

![](/docs/images/github-token.png)

## Now what?

After you've created your token, add it as an environmental variable to your Hubot instance.
Hubot will now identify filetypes included in the PR, saving a curious click-through before
claiming a PR :)

If you haven't done so already, check out the
[GitHub webhook instructions for hubot-code-review](/docs/github-webhook.md)
