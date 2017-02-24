/*eslint-env jasmine*/

// Allows 'since' custom messages for unit test failures
require('jasmine-custom-message');

var path       = require('path'),
  Robot        = require('../node_modules/hubot/src/robot'),
  TextMessage  = require('../node_modules/hubot/src/message').TextMessage,
  util         = require('./lib/util'),
  Users        = require('./data/users'),
  PullRequests = require('./data/prs'),
  CodeReview   = require('../src/CodeReview'),
  request      = require('supertest');
  schedule     = require('node-schedule');

/**
 * Tests the following features of code-review
    receives GitHub webhook to approve a PR by emoji in multiple rooms
    does not approve a CR by emoji when GitHub comment does not contain emoji
    approves a CR when GitHub comment contains github-style emoji
    approves a CR when GitHub comment contains unicode emoji
    DMs user when CR is approved by emoji
 */

describe("Code Review Emoji Approval", () => {
  var robot;
  var adapter;
  var code_reviews;

  /**
   * @var array List of Hubot User objects
   */
  var users = [];

  beforeEach((done) => {

    // create new robot, without http, using the mock adapter
    robot = new Robot(null, "mock-adapter", true, "hubot");

    robot.adapter.on("connected", () => {
      // create a user
      Users().getUsers().forEach(function(user) {
        users.push(robot.brain.userForId(user.ID, {
          name: user.meta.name,
          room: user.meta.room
        }));
      });

      // load the module
      code_reviews = require("../src/code-reviews")(robot);

      adapter = robot.adapter;
      // start each test with an empty queue
      code_reviews.flush_queues();
      // wait a sec for Redis
      setTimeout(() => {
        done();
      }, 150);
    });

    robot.run();

  });

  afterEach(() => {
    users = [];
    adapter = null;
    robot.server.close();
    robot.shutdown();
  });

  /**
   * Webhooks for issue_comment when HUBOT_CODE_REVIEW_EMOJI_APPROVE
   */

  if (process.env.HUBOT_CODE_REVIEW_EMOJI_APPROVE) {
    it('receives GitHub webhook to approve a PR by emoji in multiple rooms', (done) => {
      var rooms = ['alley', 'codereview', 'learnstuff', 'nycoffice'];
      var approvedUrl = 'https://github.com/alleyinteractive/special/pull/456'
      var otherUrl = 'https://github.com/alleyinteractive/special/pull/123';
      // add prs to different rooms
      rooms.forEach(function(room) {
        addNewCR(approvedUrl + '/files', {room: room});
        addNewCR(otherUrl, {room: room});
      });

      // setup the data we want to pretend that Github is sending
      var requestBody = {
        issue : {html_url : approvedUrl},
        comment : {
          body : 'I give it a :horse:, great job!',
          user : {login : 'bcampeau'}
        }
      };

      // expect the approved pull request to be approved in all rooms
      // and the other pull request to be unchanged
      testWebhook('issue_comment', requestBody, function(err, res) {
        expect(res.text).toBe('issue_comment approved ' + approvedUrl);
        rooms.forEach(function(room) {
          queue = code_reviews.room_queues[room];
          expect(queue.length).toBe(2);
          expect(queue[0].url).toBe(otherUrl);
          expect(queue[0].status).toBe('new');
          expect(queue[1].url).toBe(approvedUrl + '/files');
          expect(queue[1].status).toBe('approved');
          done();
        });
      });
    });

    it('does not approve a CR by emoji when GitHub comment does not contain emoji', (done) => {
      testCommentText({
        comment: 'This needs more work, sorry.',
        expectedRes: 'issue_comment did not yet approve ',
        expectedStatus: 'new'
      }, done);
    });

    it('approves a CR when GitHub comment contains github-style emoji', (done) => {
      testCommentText({
        comment: ':pizza: :pizza: :100:',
        expectedRes: 'issue_comment approved ',
        expectedStatus: 'approved'
      }, done);
    });

    it('approves a CR when GitHub comment contains unicode emoji', (done) => {
      testCommentText({
        comment: 'nice work pal 🍾',
        expectedRes: 'issue_comment approved ',
        expectedStatus: 'approved'
      }, done);
    });

    it('DMs user when CR is approved by emoji', (done) => {
      var url = 'https://github.com/alleyinteractive/huron/pull/567';
      addNewCR(url);

      // setup the data we want to pretend that Github is sending
      var requestBody = {
        issue : {
          html_url : url
        },
        comment : {
          body : "Nice job!:tada:\nMake these tweaks then :package: it!",
          user : {
            login : 'gfargo'
          }
        }
      };

      adapter.on('send', (envelope, strings) => {
        expect(strings[0]).toBe('hey ' + envelope.room + '! gfargo approved ' + url +
          ':\nNice job!:tada:\nMake these tweaks then :package: it!');
        var cr = code_reviews.room_queues.test_room[0];
        expect(envelope.room).toBe('@' +cr.user.name);
        expect(cr.url).toBe(url);
        expect(cr.status).toBe('approved');
        done();
      });

      testWebhook('issue_comment', requestBody, function(err, res) {
        expect(res.text).toBe('issue_comment approved ' + url);
      });
    });
  }

  /**
   * Helper functions
   */

  /**
   * test a request to CR webhook
   * @param string event 'issue_comment' or 'pull_request'
   * @param object requestBody Body of request as JSON object
   * @param function callback Takes error and result arguments
   */
  function testWebhook(eventType, requestBody, callback) {
  request(robot.router.listen())
    .post('/hubot/hubot-code-review')
    .set({
      'Content-Type' : 'application/json',
      'X-Github-Event' : eventType,
    })
    .send(requestBody)
    .end(function(err, res) {
      expect(err).toBeFalsy();
      callback(err, res);
    });
  }

  /**
   * Test correct handing of a comment from Github
   * @param object args
   *    string comment
   *    string expectedRes
   *    string expectedStatus
   */
  function testCommentText(args, done) {
    var url = 'https://github.com/alleyinteractive/huron/pull/567';
    addNewCR(url);

    // setup the data we want to pretend that Github is sending
    var requestBody = {
      issue : {html_url : url},
      comment : {
        body : args.comment,
        user : {login : 'bcampeau'}
      }
    };

    // not approved
    testWebhook('issue_comment', requestBody, function(err, res) {
      expect(res.text).toBe(args.expectedRes + url);
      expect(code_reviews.room_queues.test_room[0].status).toBe(args.expectedStatus);
      done();
    });
  }

  /**
   * Test selectively updating status to merged or closed
   * @param string githubStatus 'merged' or 'closed'
   * @param string localStatus Current status in code review queue
   * @param string expectedStatus Status we expect to change to (or not)
   * @param function done Optional done() function for the test
   */
  function testMergeClose(githubStatus, localStatus, expectedStatus, done) {
    var updatedUrl = 'https://github.com/alleyinteractive/special/pull/456';
    addNewCR(updatedUrl);
    code_reviews.room_queues.test_room[0].status = localStatus;
    code_reviews.room_queues.test_room[0].reviewer = 'jaredcobb';

    // setup the data we want to pretend that Github is sending
    var requestBody = {
      action : 'closed',
      pull_request : {
        merged : githubStatus === 'merged',
        html_url : updatedUrl
      }
    };

    // expect the closed pull request to be closed in all rooms
    // and the other pull request to be unchanged
    testWebhook('pull_request', requestBody, function(err, res) {
      expect(code_reviews.room_queues.test_room[0].status).toBe(expectedStatus);
      if (done) {
        done();
      }
    });
  }

  /**
   * Make a CR slug from a URL
   * @param string url
   * @return string slug
   */
  function makeSlug(url) {
    return code_reviews.matches_to_slug(code_reviews.pr_url_regex.exec(url));
  }

  /**
   * Create a new CR with a random user and add it to the queue
   * @param string url URL of GitHub PR
   * @param object userMeta Optional metadata to override GitHub User object
   * @param int randExclude Optional index in users array to exclude from submitters
   */
  function addNewCR(url, userMeta, randExclude) {
    var submitter = util.getRandom(users, randExclude).value;
    if (userMeta) {
      // shallow "extend" submitter
      Object.keys(userMeta).forEach(function(key) {
        submitter[key] = userMeta[key];
      });
    }
    code_reviews.add(new CodeReview(submitter, makeSlug(url), url));
  }

  /**
   * Get number of reviews in a room by status
   * @param string room The room to search
   * @param string status The status to search for
   * @return int|null Number of CRs matching status, or null if room not found
   */
  function roomStatusCount(room, status) {
    if (!code_reviews.room_queues[room]) {
      return null;
    }
    var counter = 0;
    code_reviews.room_queues[room].forEach(function(cr) {
      if (cr.status === status) {
        counter++;
      }
    });
    return counter;
  }

  function populateTestRoomCRs(){
    var statuses = {
      new : [],
      claimed: [],
      approved: [],
      closed: [],
      merged: []
    }
    // add a bunch of new CRs
    PullRequests.forEach(function(url, i) {
      addNewCR(url);
    });

    // make sure there's at least one CR with each status
    code_reviews.room_queues.test_room.forEach(function(review, i) {
      if (i < Object.keys(statuses).length) {
        status = Object.keys(statuses)[i];
        // update the CR's status
        code_reviews.room_queues.test_room[i].status = status;
        // add to array of expected results
        statuses[status].push(code_reviews.room_queues.test_room[i].slug);
      }
    });
  }
});
