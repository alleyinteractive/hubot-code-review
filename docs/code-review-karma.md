Code Review Karma (aka. points/leaderboard)
===================

Code Reviews take time and effort to do right; `hubot-code-review` quietly
keeps track of the number of `gives` (reviews) and `takes` (reviews requested) for code reviews across all rooms.

## Configuration

- To automatically display the monthly resetting leaderboard to a particular room, set the `HUBOT_CODE_REVIEW_KARMA_MONTHLY_AWARD_ROOM` parameter to the name of the group or channel you wish to notify.

![](/docs/images/karma-monthly-leaderboard.png)

- You can disable the code review ranking commands by setting the `HUBOT_CODE_REVIEW_KARMA_DISABLED`
environmental variable to `true`


## What can I say?

    hubot: what are the code review rankings?
	hubot: what are the monthly code review rankings?
    hubot: list all cr scores
    hubot: what is my cr score?
    hubot: what is [USER]'s cr score?
    hubot: remove [USER]'s from cr rankings
    hubot: remove [USER]'s from cr rankings
    hubot: merge [USER1]'s cr score into [USER2]'
