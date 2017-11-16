var Users = function () {
  let usersList = [
    {
      ID: 'UL7X4TN2AM',
      meta: {
        name: 'Shell',
      },
    },
    {
      ID: 'UA8J690401',
      meta: {
        name: 'Alexis',
      },
    },
    {
      ID: 'UO6GDK59VL',
      meta: {
        name: 'Davidson',
      },
    },
    {
      ID: 'U3DU3VIHQJ',
      meta: {
        name: 'Leann',
      },
    },
    {
      ID: 'UBM793RYYB',
      meta: {
        name: 'Lee',
      },
    },
    {
      ID: 'UKZBBC96H6',
      meta: {
        name: 'Welch',
      },
    },
    {
      ID: 'UQ8SM826CB',
      meta: {
        name: 'Reynolds',
      },
    },
    {
      ID: 'U9JWFZTT4X',
      meta: {
        name: 'Hardy',
      },
    },
    {
      ID: 'UHZEW2ACFC',
      meta: {
        name: 'Jacklyn',
      },
    },
    {
      ID: 'UBI4MVABXT',
      meta: {
        name: 'Vargas',
      },
    },
    {
      ID: 'UDMPZU58WB',
      meta: {
        name: 'Alston',
      },
    },
    {
      ID: 'U7NAPZ13BW',
      meta: {
        name: 'Kristina',
      },
    },
    {
      ID: 'UCGLW5IRKM',
      meta: {
        name: 'Hilda',
      },
    },
    {
      ID: 'ULTD5SPV46',
      meta: {
        name: 'Iva',
      },
    },
    {
      ID: 'U7W1YSL7L7',
      meta: {
        name: 'Dianne',
      },
    },
  ];

  const numUsers = usersList.length;

  const defaultRoom = 'test_room';

  usersList = usersList.map((user, i) => {
    user.meta.room = defaultRoom;
    user.index = i;
    return user;
  });

  /**
   * get a specific user by index
   * @param int index Index of user in list
   * @return Object User JSON object
   */
  Users.getUser = function (index) {
    return 0 <= index && index < numUsers ? usersList[index] : false;
  };

  /**
   * get all users
   * @return array List of user JSON objects
   */
  Users.getUsers = function () {
    return usersList;
  };

  return Users;
};

module.exports = Users;
