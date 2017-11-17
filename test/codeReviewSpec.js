/* eslint-env jasmine*/

// Allows 'since' custom messages for unit test failures
require('jasmine-custom-message');

let path = require('path'),
  Robot = require('../node_modules/hubot/src/robot'),
  TextMessage = require('../node_modules/hubot/src/message').TextMessage,
  util = require('./lib/util'),
  Users = require('./data/users'),
  PullRequests = require('./data/prs'),
  CodeReview = require('../src/CodeReview'),
  request = require('supertest');
schedule = require('node-schedule');

/**
 * Tests the following features of code-review
    Turning the URL of a pull request on GitHub into a code review slug
    Flushing the room queues
    Adding a CR to an empty queue
    Not duplicating a CR in the same queue
    Allowing the same CR to be added in different room queues
    claiming the oldest CR in the queue ('on it')
    claiming a specific CR by slug ('on repo/123')
    tests needed claiming all PRs in the queue ('on *')
    remove/ignore newest CR in queue
    remove/ignore specific CR by slug
    list CRs by status
    mark CR as approved via GitHub webhook
    mark CR as closed via GitHub webhook
    garbage collection
 * TODO:
    GitHub filetype extra info
    ...
 */

describe('Code Review', () => {
  let robot;
  let adapter;
  let code_reviews;

  /**
   * @var array List of Hubot User objects
   */
  let users = [];

  beforeEach((done) => {
    // create new robot, without http, using the mock adapter
    robot = new Robot(null, 'mock-adapter', true, 'hubot');

    robot.adapter.on('connected', () => {
      // create a user
      Users().getUsers().forEach((user) => {
        users.push(robot.brain.userForId(user.ID, {
          name: user.meta.name,
          room: user.meta.room,
        }));
      });

      // load the module
      code_reviews = require('../src/code-reviews')(robot);

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

  it('turns a GitHub PR URL into a Code Review slug', (done) => {
    var slug = code_reviews.matches_to_slug(code_reviews.pr_url_regex.exec('https://github.com/alleyinteractive/wordpress-fieldmanager/pull/558'));
    expect(slug).toEqual('wordpress-fieldmanager/558');
    var slug = code_reviews.matches_to_slug(code_reviews.pr_url_regex.exec('https://github.com/alleyinteractive/wordpress-fieldmanager/pull/558/files'));
    expect(slug).toEqual('wordpress-fieldmanager/558');
    done();
  });

  it('flushes the queues', (done) => {
    PullRequests.forEach((url, i) => {
      const rooms = ['alley', 'codereview', 'learnstuff', 'nycoffice'];
      addNewCR(url, { room: rooms[Math.floor(Math.random() * rooms.length)] });
    });
    expect(Object.keys(code_reviews.room_queues).length).toBeGreaterThan(0);
    // give Redis 100ms to update
    setTimeout(() => {
      expect(Object.keys(robot.brain.data.code_reviews.room_queues).length).toBeGreaterThan(0);
      code_reviews.flush_queues();
      setTimeout(() => {
        expect(Object.keys(code_reviews.room_queues).length).toBe(0);
        expect(Object.keys(robot.brain.data.code_reviews.room_queues).length).toBe(0);
        done();
      }, 100);
    }, 100);
  });

  it('adds a CR to empty queue', (done) => {
    // make sure queue is empty
    expect(Object.keys(code_reviews.room_queues).length).toEqual(0);

    const currentUser = users[6];
    const currentCR = PullRequests[4];
    const slug = code_reviews.matches_to_slug(code_reviews.pr_url_regex.exec(currentCR));
    const re = new RegExp(`^\\*${slug}\\* is now in the code review queue. Let me know if anyone starts reviewing this\.$`);

    adapter.on('send', (envelope, strings) => {
      // there should now be one room from the current user
      const rooms = Object.keys(code_reviews.room_queues);
      expect(rooms.length).toEqual(1);
      expect(rooms[0]).toEqual(currentUser.room);

      // there should be one CR in the room queue
      expect(code_reviews.room_queues[rooms[0]].length).toEqual(1);
      expect(code_reviews.room_queues[rooms[0]][0].url).toEqual('https://github.com/alleyinteractive/ad-layers/pull/1');

      // hubot replies as expected
      expect(strings[0]).toMatch(re);
      done();
    });

    // add a PR URL to the queue
    adapter.receive(new TextMessage(currentUser, currentCR));
  });

  it('will not a allow the same CR in the same room regardless of status', (done) => {
    const currentUser = users[7];
    const url = PullRequests[4];
    code_reviews.add(new CodeReview(currentUser, makeSlug(url), url));

    // listener for second time the CR is added
    adapter.on('send', (envelope, strings) => {
      // should still be one CR in the queue
      expect(code_reviews.room_queues[currentUser.room].length).toEqual(1);

      // test different CR status next time
      if ('new' === code_reviews.room_queues[currentUser.room][0].status) {
        code_reviews.room_queues[currentUser.room][0].status = 'claimed';
      } else if ('claimed' === code_reviews.room_queues[currentUser.room][0].status) {
        code_reviews.room_queues[currentUser.room][0].status = 'approved';
      } else if ('approved' === code_reviews.room_queues[currentUser.room][0].status) {
        done();
      }
    });

    // try to add the CR again a few times
    util.sendMessageAsync(adapter, currentUser, url, 100);
    util.sendMessageAsync(adapter, currentUser, url, 200);
    util.sendMessageAsync(adapter, currentUser, url, 300);
  });

  it('will allow the same CR in a different room', (done) => {
    const currentUser = users[12];
    const url = PullRequests[6];
    const firstRoom = currentUser.room;
    code_reviews.add(new CodeReview(currentUser, makeSlug(url), url));

    // listener for second time the CR is added
    adapter.on('send', (envelope, strings) => {
      // room names should be different
      expect(firstRoom).not.toBe(envelope.room);

      const firstQueue = code_reviews.room_queues[firstRoom];
      const secondQueue = code_reviews.room_queues[envelope.room];

      // rooms should both have 1 CR
      expect(firstQueue.length).toEqual(1);
      expect(secondQueue.length).toEqual(1);
      // the CR should be the same
      expect(firstQueue[0].slug).toBe(secondQueue[0].slug);
      done();
    });

    // add the CR again in a different room
    currentUser.room = 'a_different_room';
    util.sendMessageAsync(adapter, currentUser, url, 300);
  });

  it('claims the first CR added to the queue', (done) => {
    const reviewer = users[2];
    const urlsToAdd = [PullRequests[0], PullRequests[1], PullRequests[2], PullRequests[3]];
    urlsToAdd.forEach((url, i) => {
      addNewCR(url, {}, 2);
    });

    let alreadyReceived = false;
    adapter.on('send', (envelope, strings) => {
      // make sure we only get one response
      expect(alreadyReceived).toBeFalsy();
      if (alreadyReceived) {
        done();
      } else {
        alreadyReceived = true;
        setTimeout(done, 100);
      }

      // should still have 4 CRs in the queue
      expect(code_reviews.room_queues[reviewer.room].length).toBe(4);

      // first one added should be claimed by reviewer
      expect(code_reviews.room_queues[reviewer.room][3].status).toBe('claimed');
      expect(code_reviews.room_queues[reviewer.room][3].reviewer).toBe(reviewer.name);

      // the rest should still be new and have no reviewer
      const unclaimedLength = code_reviews.room_queues[reviewer.room].length - 1;
      for (let i = 0; i < unclaimedLength; i++) {
        expect(code_reviews.room_queues[reviewer.room][i].status).toBe('new');
        expect(code_reviews.room_queues[reviewer.room][i].reviewer).toBeFalsy();
      }
    });

    // wait for all the CRs to be added, then test
    util.sendMessageAsync(adapter, reviewer, 'on it', 300);
  });

  it('claims specific CR from queue', (done) => {
    const slug = 'wordpress-fieldmanager/559';
    const reviewer = users[9];
    const urlsToAdd = [PullRequests[1], PullRequests[2], PullRequests[3]];
    urlsToAdd.forEach((url, i) => {
      addNewCR(url, {}, 9);
    });

    adapter.on('send', (envelope, strings) => {
      for (let i = 0; i < code_reviews.room_queues[reviewer.room].length; i++) {
        // the right one should be claimed
        if (slug === code_reviews.room_queues[reviewer.room][i].slug) {
          expect(code_reviews.room_queues[reviewer.room][i].status).toBe('claimed');
          expect(code_reviews.room_queues[reviewer.room][i].reviewer).toBe(reviewer.name);
        }
        // the rest should still be new and have no reviewer
        else {
          expect(code_reviews.room_queues[reviewer.room][i].status).toBe('new');
          expect(code_reviews.room_queues[reviewer.room][i].reviewer).toBeFalsy();
        }
      }
      done();
    });

    // claim the CR
    util.sendMessageAsync(adapter, reviewer, `on ${slug}`, 300);
  });

  it('resets a PR', (done) => {
    // add a bunch of new CRs
    PullRequests.forEach((url, i) => {
      addNewCR(url);
    });

    // be unspecific
    util.sendMessageAsync(adapter, users[1], 'unclaim', 1, (envelope, strings) => {
      expect(strings[0]).toBe('Sorry, can you be more specific?');
    });

    // claim a CR
    util.sendMessageAsync(adapter, users[0], 'on ad-layers/1', 1, () => {
      expect(code_reviews.room_queues.test_room[2].status).toBe('claimed');
      expect(code_reviews.room_queues.test_room[2].reviewer).toBe(users[0].name);
    });

    // be wrong
    util.sendMessageAsync(adapter, users[0], 'hubot: reset foo/99', 50, (envelope, strings) => {
      expect(strings[0]).toBe('Sorry, I couldn\'t find any PRs in this room matching `foo/99`.');
    });

    // unclaim the CR
    util.sendMessageAsync(adapter, users[0], 'hubot: unclaim ad-layers/1', 100, (envelope, strings) => {
      expect(code_reviews.room_queues.test_room[2].status).toBe('new');
      expect(code_reviews.room_queues.test_room[2].reviewer).toBe(false);
      expect(strings[0]).toBe('You got it, I\'ve unclaimed *ad-layers/1* in the queue.');
      done();
    });
  });

  it('sets a PR for a new review without a score penalty for original reviewer', (done) => {
    // someone else adds a CR
    addNewCR(PullRequests[0], null, 1);

    // user claims the CR
    util.sendMessageAsync(adapter, users[1], 'on wp-seo/378', 1, (envelope, strings) => {
      // should be claimed by that user
      expect(code_reviews.room_queues.test_room[0].status).toBe('claimed');
      expect(code_reviews.room_queues.test_room[0].reviewer).toBe(users[1].name);

      // "redo" should reset the CR without decrementing user's score
      util.sendMessageAsync(adapter, users[1], 'hubot: redo wp-seo/378', 1, (envelope, strings) => {
        expect(code_reviews.room_queues.test_room[0].status).toBe('new');
        expect(code_reviews.room_queues.test_room[0].reviewer).toBe(false);
        expect(strings[0]).toBe('You got it, wp-seo/378 is ready for a new review.');
        done();
      });
    });
  });

  it('claims a review by searching for its slug', (done) => {
    const reviewer = users[9];
    // add a bunch of new CRs
    PullRequests.forEach((url, i) => {
      addNewCR(url, {}, 9);
    });
    // simulate a PR that was approved and updated by webhook before being claimed from queue
    code_reviews.room_queues.test_room[0].status = 'approved';

    // 0 matches
    util.sendMessageAsync(adapter, users[7], 'on foobar', 50, (envelope, strings) => {
      expect(strings[0]).toBe('Sorry, I couldn\'t find any new PRs in this room matching `foobar`.');
    });

    // multiple unclaimed matches
    util.sendMessageAsync(adapter, users[7], 'on fieldmanager', 100, (envelope, strings) => {
      expect(strings[0]).toBe('You\'re gonna have to be more specific: `wordpress-fieldmanager/558`, or `wordpress-fieldmanager/559`?');
    });

    // 1 match, unclaimed
    util.sendMessageAsync(adapter, users[7], 'on 559', 300, (envelope, strings) => {
      expect(strings[0]).toBe(`Thanks, ${users[7].name}! I removed *wordpress-fieldmanager/559* from the code review queue.`);
    });

    // 1 match, claimed
    util.sendMessageAsync(adapter, users[8], 'on 559', 500, (envelope, strings) => {
      const bothResponses = new RegExp('Sorry, I couldn\'t find any new PRs in this room matching `559`.' +
        '|It looks like \\*wordpress-fieldmanager\/559\\* \\(@[a-zA-Z]+\\) has already been claimed');
      expect(strings[0]).toMatch(bothResponses);
    });

    // multiple matches, only 1 is unclaimed
    util.sendMessageAsync(adapter, users[8], 'on fieldmanager', 700, (envelope, strings) => {
      expect(strings[0]).toBe(`Thanks, ${users[8].name}! I removed *wordpress-fieldmanager/558* from the code review queue.`);
    });

    // multiple matches, all claimed
    util.sendMessageAsync(adapter, users[8], 'on fieldmanager', 800, (envelope, strings) => {
      expect(strings[0]).toBe('Sorry, I couldn\'t find any new PRs in this room matching `fieldmanager`.');
    });

    // matches CR that was updated (e.g. by webhook) before it was claimed
    util.sendMessageAsync(adapter, users[8], 'on photon', 1000, (envelope, strings) => {
      const theCr = code_reviews.room_queues.test_room[0];
      const bothResponses = new RegExp(`${'Sorry, I couldn\'t find any new PRs in this room matching `photon`.' +
        '|It looks like \\*'}${theCr.slug}\\* \\(@${theCr.user.name}\\) has already been ${theCr.status}`);
      expect(strings[0]).toMatch(bothResponses);
      done();
    });
  });

  it('claims all new CRs in the queue', (done) => {
    // add 7 PR across two rooms
    code_reviews.room_queues.test_room = [];
    code_reviews.room_queues.second_room = [];
    PullRequests.forEach((url, i) => {
      const cr = new CodeReview(users[6], makeSlug(url), url);
      const room = 3 >= i ? 'test_room' : 'second_room';
      code_reviews.room_queues[room].unshift(cr);
    });
    expect(roomStatusCount('test_room', 'new')).toBe(4);
    expect(roomStatusCount('second_room', 'new')).toBe(3);

    let responsesReceived = 0;
    util.sendMessageAsync(adapter, users[0], 'on *', 1000, (envelope, strings) => {
      if (0 === responsesReceived) {
        expect(strings[0]).toMatch(/:tornado2?:/);
      } else {
        slug = makeSlug(PullRequests[responsesReceived - 1]);
        expect(strings[0]).toBe(`Thanks, ${users[0].name}! I removed *${slug}* from the code review queue.`);
      }
      responsesReceived++;

      if (5 === responsesReceived) { // 5 = :tornado2: + 4 unclaimed reviews
        // should have claimed all reviews in test_room and none of the reviews in second_room
        expect(roomStatusCount('test_room', 'claimed')).toBe(4);
        expect(roomStatusCount('test_room', 'new')).toBe(0);
        expect(roomStatusCount('second_room', 'new')).toBe(3);
        testSecondRoom();
      }
    });

    // test `on *` in a room after claiming a PR
    var testSecondRoom = () => {
      // claim the most recently added PR
      code_reviews.update_cr(code_reviews.room_queues.second_room[0], 'claimed', users[2].name);
      expect(roomStatusCount('second_room', 'claimed')).toBe(1);
      users[3].room = 'second_room';
      responsesReceived = 0;
      util.sendMessageAsync(adapter, users[3], 'on *', 1000, (envelope, strings) => {
        responsesReceived++;
        if (3 === responsesReceived) { // 3 = :tornado2: + 2 unclaimed reviews
          expect(roomStatusCount('second_room', 'new')).toBe(0);
          expect(roomStatusCount('second_room', 'claimed')).toBe(3);
          done();
        }
      });
    };
  });

  it('ignores timer start command', (done) => {
    let receivedMessage = false;
    adapter.on('send', (envelope, strings) => {
      // we received a message when we shouldn't have
      receivedMessage = true;
    });
    util.sendMessageAsync(adapter, users[0], 'working on staff');

    setTimeout(() => {
      expect(receivedMessage).toBe(false);
      done();
    }, 150);
  });

  it('ignores the newest CR', (done) => {
    // add a bunch of new CRs
    PullRequests.forEach((url, i) => {
      addNewCR(url);
    });

    // wait until all 7 are added asynchronously
    var addCrsInterval = setInterval(() => {
      if (code_reviews.room_queues.test_room.length >= PullRequests.length) {
        clearInterval(addCrsInterval);
        expect(code_reviews.room_queues.test_room[0].slug).toBe('photonfill/18');
        // ignore newest CR
        util.sendMessageAsync(adapter, users[8], 'hubot ignore', 1, (envelope, strings) => {
          expect(code_reviews.room_queues.test_room.length).toBe(PullRequests.length - 1);
          expect(code_reviews.room_queues.test_room[0].slug).toBe('wordpress-fieldmanager/558');
          done();
        });
      }
    }, 50);
  });

  it('ignores specific CR', (done) => {
    const reviewer = users[9];
    const urlsToAdd = [PullRequests[1], PullRequests[2], PullRequests[3]];
    urlsToAdd.forEach((url, i) => {
      addNewCR(url, {}, 9);
    });

    adapter.on('send', (envelope) => {
      const slug = envelope.message.text.match(/ignore (.*)/)[1];
      const slugsInRoom = [];
      for (let i = 0; i < code_reviews.room_queues[reviewer.room].length; i++) {
        // specific slug should be ignored
        slugsInRoom.push(code_reviews.room_queues[reviewer.room][i].slug);
        since(`Expect the ignored slug: ${slug} to be gone from the room`)
          .expect(slug === code_reviews.room_queues[reviewer.room][i].slug).toBe(false);
      }
      // unmentioned slug should still be in the room
      since('Expected slugs that weren\'t ignored are still present in the room')
        .expect(slugsInRoom.includes('searchpress/23')).toBe(true);
    });

    // ignore a couple specific crs
    util.sendMessageAsync(adapter, reviewer, 'hubot ignore wordpress-fieldmanager/559', 100, (envelope, strings) => {
      expect(strings[0]).toBe('Sorry for eavesdropping. I removed *wordpress-fieldmanager/559* from the queue.');
    });
    util.sendMessageAsync(adapter, reviewer, 'hubot ignore huron', 400, (envelope, strings) => {
      expect(strings[0]).toBe('Sorry for eavesdropping. I removed *huron/567* from the queue.');
      done();
    });
  });

  it('lists all CRs', (done) => {
    populateTestRoomCRs();
    adapter.on('send', (envelope, strings) => {
      status = 'all';
      // test message preface
      if ('new' === status) {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach((cr, i) => {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        const CRFound = 0 <= strings[0].indexOf(`*<${cr.url}|${cr.slug}>*`);
        if (status === cr.status || 'all' === status) {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
    adapter.receive(new TextMessage(users[8], 'hubot list all crs'));
  });

  it('lists new CRs', (done) => {
    populateTestRoomCRs();
    adapter.on('send', (envelope, strings) => {
      status = 'new';
      // test message preface
      if ('new' === status) {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach((cr, i) => {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        const CRFound = 0 <= strings[0].indexOf(`*<${cr.url}|${cr.slug}>*`);
        if (status === cr.status || 'all' === status) {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
    adapter.receive(new TextMessage(users[8], 'hubot list new crs'));
  });

  it('lists claimed CRs', (done) => {
    populateTestRoomCRs();
    adapter.on('send', (envelope, strings) => {
      status = 'claimed';
      // test message preface
      if ('new' === status) {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach((cr, i) => {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        const CRFound = 0 <= strings[0].indexOf(`*<${cr.url}|${cr.slug}>*`);
        if (status === cr.status || 'all' === status) {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
    adapter.receive(new TextMessage(users[8], 'hubot list claimed crs'));
  });

  it('lists approved CRs', (done) => {
    populateTestRoomCRs();
    adapter.on('send', (envelope, strings) => {
      status = 'approved';
      // test message preface
      if ('new' === status) {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach((cr, i) => {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        const CRFound = 0 <= strings[0].indexOf(`*<${cr.url}|${cr.slug}>*`);
        if (status === cr.status || 'all' === status) {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
    adapter.receive(new TextMessage(users[8], 'hubot list approved crs'));
  });

  it('lists closed CRs', (done) => {
    populateTestRoomCRs();
    adapter.on('send', (envelope, strings) => {
      status = 'closed';
      // test message preface
      if ('new' === status) {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach((cr, i) => {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        const CRFound = 0 <= strings[0].indexOf(`*<${cr.url}|${cr.slug}>*`);
        if (status === cr.status || 'all' === status) {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
    adapter.receive(new TextMessage(users[8], 'hubot list closed crs'));
  });

  it('lists merged CRs', (done) => {
    populateTestRoomCRs();
    adapter.on('send', (envelope, strings) => {
      status = 'merged';
      // test message preface
      if ('new' === status) {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach((cr, i) => {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        const CRFound = 0 <= strings[0].indexOf(`*<${cr.url}|${cr.slug}>*`);
        if (status === cr.status || 'all' === status) {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
    adapter.receive(new TextMessage(users[8], 'hubot list merged crs'));
  });

  it('includes timeago information when listing crs', (done) => {
    const statuses = ['new', 'claimed', 'approved', 'closed', 'merged'];
    const halfHourInMs = 1000 * 60 * 30;
    // add CRs with different ages and statuses
    statuses.forEach((status, i) => {
      const cr = new CodeReview(users[i], makeSlug(PullRequests[i]), PullRequests[i]);
      cr.status = status;
      cr.last_updated += -1 * i * halfHourInMs;
      code_reviews.add(cr);
    });

    adapter.on('send', (envelope, strings) => {
      const crsList = strings[0].split('\n');
      crsList.reverse(); // since we add to queue by unshift() instead of push()
      expect(crsList[0]).toMatch(/added a few seconds ago\)$/);
      expect(crsList[1]).toMatch(/claimed 30 minutes ago\)$/);
      expect(crsList[2]).toMatch(/approved an hour ago\)$/);
      expect(crsList[3]).toMatch(/closed 2 hours ago\)$/);
      expect(crsList[4]).toMatch(/merged 2 hours ago\)$/);
      expect(crsList[5]).toMatch(/Here's a list of all code reviews for you.$/);
      done();
    });
    adapter.receive(new TextMessage(users[0], 'hubot list all crs'));
  });

  it('recognizes strings containing emoji', (done) => {
    // valid comments
    [
      ':horse:',
      ':+1:',
      'nice job!\n:package:\ngo ahead and deploy',
      ':pineapple::pizza:',
      'looking good :chart_with_upwards_trend:',
    ].forEach((string) => {
      if (! code_reviews.emoji_regex.test(string)) {
        console.log(string);
      }
      expect(code_reviews.emoji_regex.test(string)).toBe(true);
    });

    [
      '😘',
      '🐩🚢',
      'nice work 🎉 code',
    ].forEach((string) => {
      expect(code_reviews.emoji_unicode_test(string)).toBe(true);
    });

    // invalid comments
    [
      'this needs some work',
      'note: this:is not finished',
      'nice job:\nyou:',
    ].forEach((string) => {
      expect(code_reviews.emoji_regex.test(string)).toBe(false);
      expect(code_reviews.emoji_unicode_test(string)).toBe(false);
    });

    done();
  });

  /**
   * Webhooks for approval, merging, and closing
   */

  it('does not allow invalid GitHub event webhooks', (done) => {
    testWebhook('something_else', { foo: 'bar' }, (err, res) => {
      expect(res.status).toBe(400);
      expect(res.text).toBe('invalid x-github-event something_else');
      done();
    });
  });

  it('receives GitHub pull_request_review webhook to handle a PR in multiple rooms', (done) => {
    const rooms = ['alley', 'codereview', 'learnstuff', 'nycoffice'];
    const approvedUrl = 'https://github.com/alleyinteractive/special/pull/456';
    const otherUrl = 'https://github.com/alleyinteractive/special/pull/123';
    // add prs to different rooms
    rooms.forEach((room) => {
      addNewCR(`${approvedUrl}/files`, { room });
      addNewCR(otherUrl, { room });
    });

    // setup the data we want to pretend that Github is sending
    const requestBody = {
      pull_request: { html_url: approvedUrl },
      review: {
        body: 'Awesome!',
        state: 'approved',
        user: { login: 'jaredcobb' },
      },
    };

    // setup the data we want to pretend that Github is sending
    const notApprovedRequestBody = {
      pull_request: { html_url: otherUrl },
      review: {
        body: 'Needs some changes',
        state: 'rejected',
        user: { login: 'mboynes' },
      },
    };

    // expect the approved pull request to be approved in all rooms
    // and the other pull request to be unchanged
    testWebhook('pull_request_review', requestBody, (err, res) => {
      expect(res.text).toBe(`pull_request_review approved ${approvedUrl}`);
      rooms.forEach((room) => {
        queue = code_reviews.room_queues[room];
        expect(queue.length).toBe(2);
        expect(queue[0].url).toBe(otherUrl);
        expect(queue[0].status).toBe('new');
        expect(queue[1].url).toBe(`${approvedUrl}/files`);
        expect(queue[1].status).toBe('approved');
      });
    });

    testWebhook('pull_request_review', notApprovedRequestBody, (err, res) => {
      expect(res.text).toBe(`pull_request_review not yet approved ${otherUrl}`);
      rooms.forEach((room) => {
        queue = code_reviews.room_queues[room];
        expect(queue.length).toBe(2);
        expect(queue[0].url).toBe(otherUrl);
        expect(queue[0].status).toBe('new');
        expect(queue[1].url).toBe(`${approvedUrl}/files`);
        expect(queue[1].status).toBe('approved');
        done();
      });
    });
  });

  it('DMs user when CR is approved', (done) => {
    const url = 'https://github.com/alleyinteractive/huron/pull/567';
    addNewCR(url);

    // setup the data we want to pretend that Github is sending
    const requestBody = {
      pull_request: { html_url: url },
      review: {
        body: 'Nice work thinking through the implications!',
        state: 'approved',
        user: { login: 'gfargo' },
      },
    };
    adapter.on('send', (envelope, strings) => {
      expect(strings[0]).toBe(`hey ${envelope.room
      }! gfargo approved ${url}:\nNice work thinking through the implications!`);
      const cr = code_reviews.room_queues.test_room[0];
      expect(envelope.room).toBe(`@${cr.user.name}`);
      expect(cr.url).toBe(url);
      expect(cr.status).toBe('approved');
      done();
    });

    testWebhook('pull_request_review', requestBody, (err, res) => {
      expect(res.text).toBe(`pull_request_review approved ${url}`);
    });
  });

  it('DMs user when CR isn\'t approved', (done) => {
    const url = 'https://github.com/alleyinteractive/huron/pull/567';
    addNewCR(url);

    // setup the data we want to pretend that Github is sending
    const requestBody = {
      pull_request: { html_url: url },
      review: {
        body: 'Spaces. Not tabs.',
        state: 'rejected',
        user: { login: 'zgreen' },
      },
    };
    adapter.on('send', (envelope, strings) => {
      expect(strings[0]).toBe(`hey ${envelope.room
      }, zgreen commented on ${url}:\nSpaces. Not tabs.`);
      const cr = code_reviews.room_queues.test_room[0];
      expect(envelope.room).toBe(`@${cr.user.name}`);
      expect(cr.url).toBe(url);
      expect(cr.status).toBe('new');
      done();
    });

    testWebhook('pull_request_review', requestBody, (err, res) => {
      expect(res.text).toBe(`pull_request_review not yet approved ${url}`);
    });
  });

  it('updates an approved pull request to merged', (done) => {
    testMergeClose('merged', 'approved', 'merged', done);
  });

  it('updates an approved pull request to closed', (done) => {
    testMergeClose('closed', 'approved', 'closed', done);
  });

  it('does not update a new PR to merged', (done) => {
    adapter.on('send', (envelope, strings) => {
      expect(strings[0]).toBe('*special/456* has been merged but still needs to be reviewed, just fyi.');
      expect(envelope.room).toBe('test_room');
      done();
    });
    testMergeClose('merged', 'new', 'new');
  });

  it('does not update a claimed PR to merged', (done) => {
    adapter.on('send', (envelope, strings) => {
      expect(strings[0]).toBe('Hey @jaredcobb, *special/456* has been merged but you should keep reviewing.');
      expect(envelope.room).toBe('test_room');
      done();
    });
    testMergeClose('merged', 'claimed', 'claimed');
  });

  it('does not update a new PR to closed', (done) => {
    adapter.on('send', (envelope, strings) => {
      expect(strings[0]).toMatch(/Hey @(\w+), looks like \*special\/456\* was closed on GitHub\. Say `ignore special\/456` to remove it from the queue\./i);
      expect(envelope.room).toBe('test_room');
      done();
    });
    testMergeClose('closed', 'new', 'new');
  });

  it('does not update a claimed PR to closed', (done) => {
    adapter.on('send', (envelope, strings) => {
      expect(strings[0]).toMatch(/Hey @jaredcobb, \*special\/456\* was closed on GitHub\. Maybe ask @(\w+) if it still needs to be reviewed\./i);
      expect(envelope.room).toBe('test_room');
      done();
    });
    testMergeClose('closed', 'claimed', 'claimed');
  });

  /**
   * Garbage Collection
   */

  it('collects the garbage', (done) => {
    // should start with job scheduled but nothing collected
    expect(code_reviews.garbage_job.pendingInvocations().length).toBe(1);
    expect(code_reviews.garbage_last_collection).toBe(0);

    // add old and new CRs
    addNewCR(PullRequests[0]);
    addNewCR(PullRequests[1]);
    addNewCR(PullRequests[2], { room: 'otherRoom' });
    addNewCR(PullRequests[3], { room: 'otherRoom' });
    code_reviews.room_queues.test_room[1].last_updated -= (code_reviews.garbage_expiration + 1000);
    code_reviews.room_queues.otherRoom[1].last_updated -= (code_reviews.garbage_expiration + 1000);

    // invoke next collection manually
    // no need to re-test that node-schedule works as expected
    code_reviews.garbage_job.invoke();

    // should have collected 1 from each room and left the right ones alone
    expect(code_reviews.garbage_last_collection).toBe(2);
    expect(code_reviews.room_queues.test_room[0].url).toBe(PullRequests[1]);
    expect(code_reviews.room_queues.otherRoom[0].url).toBe(PullRequests[3]);
    done();
  });

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
        'Content-Type': 'application/json',
        'X-Github-Event': eventType,
      })
      .send(requestBody)
      .end((err, res) => {
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
    const url = 'https://github.com/alleyinteractive/huron/pull/567';
    addNewCR(url);

    // setup the data we want to pretend that Github is sending
    const requestBody = {
      issue: { html_url: url },
      comment: {
        body: args.comment,
        user: { login: 'bcampeau' },
      },
    };

    // not approved
    testWebhook('issue_comment', requestBody, (err, res) => {
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
    const updatedUrl = 'https://github.com/alleyinteractive/special/pull/456';
    addNewCR(updatedUrl);
    code_reviews.room_queues.test_room[0].status = localStatus;
    code_reviews.room_queues.test_room[0].reviewer = 'jaredcobb';

    // setup the data we want to pretend that Github is sending
    const requestBody = {
      action: 'closed',
      pull_request: {
        merged: 'merged' === githubStatus,
        html_url: updatedUrl,
      },
    };

    // expect the closed pull request to be closed in all rooms
    // and the other pull request to be unchanged
    testWebhook('pull_request', requestBody, (err, res) => {
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
    const submitter = util.getRandom(users, randExclude).value;
    if (userMeta) {
      // shallow "extend" submitter
      Object.keys(userMeta).forEach((key) => {
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
    if (! code_reviews.room_queues[room]) {
      return null;
    }
    let counter = 0;
    code_reviews.room_queues[room].forEach((cr) => {
      if (cr.status === status) {
        counter++;
      }
    });
    return counter;
  }

  function populateTestRoomCRs() {
    const statuses = {
      new: [],
      claimed: [],
      approved: [],
      closed: [],
      merged: [],
    };
    // add a bunch of new CRs
    PullRequests.forEach((url, i) => {
      addNewCR(url);
    });

    // make sure there's at least one CR with each status
    code_reviews.room_queues.test_room.forEach((review, i) => {
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
