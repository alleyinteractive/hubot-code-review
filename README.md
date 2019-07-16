hubot-code-review
===================

[![Travis branch](https://img.shields.io/travis/alleyinteractive/hubot-code-review/master.svg?maxAge=2592000)](https://travis-ci.org/alleyinteractive/hubot-code-review)
[![npm version](https://badge.fury.io/js/hubot-code-review.svg)](https://badge.fury.io/js/hubot-code-review)

A Hubot script for GitHub code review on Slack.

## tldr;

Drop a GitHub pull request url into a room, and Hubot adds the pull request
to the room's queue (each room has its own queue)...

![](/docs/images/submit-pr.png)

Every 5 minutes, Hubot reports the current code review queue to the room (after an hour of no interaction, it messages @here with a warning and switches to hourly reminders)...

![](/docs/images/remind-pr.png)

A co-worker can claim it for review...

![](/docs/images/claim-pr.png)

Once the review is complete, a GitHub webhook listener catches approvals and Direct Messages the submitter:

![](/docs/images/approve-pr.png)

## Requirements

* [Hubot](http://hubot.github.com/) ^3
* [hubot-slack](https://github.com/slackapi/hubot-slack) ^4

## Installation via NPM

Run the following command to install this module as a Hubot dependency

```
npm install hubot-code-review --save
```

Confirm that hubot-code-review appears as a dependency in your Hubot package.json file.

```
"dependencies": {
  ...
  "hubot-code-review": "*",
  ...
}
```

To enable the script, add the hubot-code-review entry to the external-scripts.json file (you may need to create this file).

```
[
  ...
  "hubot-code-review",
  ...
]
```

## Configuration

Code review queuing and notifications will work out of the box, but magic like
file type lookups or DMs when your PR is approved/rejected require 2 things:

1) **Create a `hubot-code-review` webhook in GitHub so that Hubot can notice any changes**

- [GitHub webhook instructions for hubot-code-review](/docs/github-webhook.md)

2) **Set Environmental variables:**

- If you set ```HUBOT_ENTERPRISE_GITHUB_URL``` to `https://<your_enterprise_url>`, Hubot will use it as your enterprise URL instead of the default: `https://github.com`

- If ```HUBOT_GITHUB_TOKEN``` is set, Hubot can query the GitHub api for file type information on PR submission. Check out the instructions for configuring
[`HUBOT_GITHUB_TOKEN` for hubot-code-review](/docs/HUBOT_GITHUB_TOKEN.md)

- Set ```HUBOT_CODE_REVIEW_REMINDER_MINUTES``` to customize the number of minutes between pending code review prompts during the first hour of inactivity (the default is 5, and the effective max is 60). Note that hourly reminders will still take effect after the first 60 minutes.

- Set ```HUBOT_CODE_REVIEW_KARMA_DISABLED``` to `true` to prevent Hubot from listening for any
[code review karma](/docs/code-review-karma.md) commands.

- Set ```HUBOT_CODE_REVIEW_KARMA_MONTHLY_AWARD_ROOM``` to automatically display a monthly resetting code review leaderboard to a particular room (for more info, check out the [code review karma](/docs/code-review-karma.md) docs)

- ```HUBOT_CODE_REVIEW_EMOJI_APPROVE``` an [Alley Interactive](https://www.alleyinteractive.com) cultural relic before the days GitHub incorporated [pull request reviews](https://help.github.com/articles/about-pull-request-reviews/). If this variable is `true`, a comment on the PR that includes one or more emoji conveys PR approval
and will DM the submitter accordingly.


## Usage

`hubot help crs` - See a help document explaining how to use.

	{GitHub pull request URL} [@user]   Add PR to queue and (optionally) notify @user or #channel
	[hubot ]on it                       Claim the oldest _new_ PR in the queue
	[hubot ]userName is on it           Tell hubot that userName has claimed the oldest _new_ PR in the queue
	on *                                Claim all _new_ PRs
	[userName is ]on cool-repo/123      Claim cool-repo/123 if no one else has claimed it
	[userName is ]on cool               Claim a _new_ PR whose slug matches cool
	hubot (nm|ignore) cool-repo/123		Delete cool-repo/123 from queue regardless of status
	hubot (nm|ignore) cool            	Delete most recently added PR whose slug matches cool
	hubot (nm|ignore)                   Delete most recently added PR from the queue regardless of status
	hubot redo cool-repo/123            Allow another review _without_ decrementing previous reviewer's score
	hubot (unclaim|reset) cool-repo/123 Reset CR status to new/unclaimed _and_ decrement reviewer's score
	hubot list crs                      List all _unclaimed_ CRs in the queue
	hubot list [status] crs             List CRs with matching optional status
_Note that some commands require direct @hubot, some don't, and some work either way._


*Code review statuses*

	new		PR has just been added to the queue, no one is on it.
	claimed		Someone is on this PR
	approved	PR was approved. Requires GitHub webhook.
	merged		PR was merged and closed. Requires GitHub webhook.
	closed		PR was closed without merging. Requires GitHub webhook.


