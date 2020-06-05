'use strict';

// Utils
const { strip } = require('../utils/cmd');

const Datastore = require('nedb-promise');
const R = require('ramda');

const User = new Datastore({
	autoload: true,
	filename: 'data/User.db',
	timestampData: true,
});

User.ensureIndex({
	fieldName: 'id',
	unique: true,
});

User.ensureIndex({
	fieldName: 'status',
});

// Migration
User.update(
	{ username: '' },
	{ $unset: { username: true } },
	{ multi: true },
).then(() =>
	User.ensureIndex({ fieldName: 'username', sparse: true, unique: true }));

const normalizeTgUser = R.pipe(
	R.pick([ 'first_name', 'id', 'last_name', 'username' ]),
	R.evolve({ username: R.toLower }),
	R.merge({ first_name: '', last_name: '' }),
);

const getUpdatedDocument = R.prop(1);

const getUser = user =>
	User.findOne(user);

const updateUser = async (rawTgUser) => {
	const tgUser = normalizeTgUser(rawTgUser);

	const { id, username } = tgUser;

	const [ rawDbUser ] = await Promise.all([
		getUser({ id }),
		User.update({ $not: { id }, username }, { $unset: { username: true } }),
	]);

	if (rawDbUser === null) {
		return User.update(
			{ id },
			{ status: 'member', warns: [], ...tgUser },
			{ returnUpdatedDocs: true, upsert: true },
		).then(getUpdatedDocument);
	}

	const dbUser = rawDbUser;

	if (!R.whereEq(tgUser, dbUser)) {
		return User.update(
			{ id },
			{ $set: tgUser },
			{ returnUpdatedDocs: true },
		).then(getUpdatedDocument);
	}

	return dbUser;
};

const admin = ({ id }) =>
	User.update(
		{ id },
		{ $set: { status: 'admin', warns: [] } },
	);

const getAdmins = () =>
	User.find({ status: 'admin' });

const unadmin = ({ id }) =>
	User.update({ id }, { $set: { status: 'member' } });

const isAdmin = (user) => {
	if (!user) return false;

	if (user.status) return user.status === 'admin';

	return User.findOne({ id: user.id, status: 'admin' });
};

const ban = ({ id }, ban_details) =>
	User.update(
		{ id, $not: { status: 'admin' } },
		{ $set: { ban_details, status: 'banned' } },
		{ upsert: true },
	);

const batchBan = (users, ban_details) =>
	User.update(
		{ $or: users.map(strip), $not: { status: 'admin' } },
		{ $set: { ban_details, status: 'banned' } },
		{ multi: true, returnUpdatedDocs: true },
	).then(getUpdatedDocument);

const ensureExists = ({ id }) =>
	id && User.insert({ id, status: 'member', warns: [] }).catch(R.F);

const unban = ({ id }) =>
	User.update(
		{ id },
		{
			$set: { status: 'member' },
			$unset: { ban_details: true, ban_reason: true },
		},
	);

const warn = ({ id }, reason, { amend }) =>
	User.update(
		{ id, $not: { status: 'admin' } },
		{ $pop: { warns: +!!amend }, $push: { warns: reason } },
		{ returnUpdatedDocs: true },
	).then(getUpdatedDocument);

const unwarn = ({ id }, warnQuery) =>
	User.update(
		{ id },
		{
			$pull: { warns: warnQuery },
			$set: { status: 'member' },
			$unset: { ban_details: true, ban_reason: true },
		},
	);

const nowarns = query => unwarn(query, {});

module.exports = {
	admin,
	ban,
	batchBan,
	ensureExists,
	getAdmins,
	getUser,
	isAdmin,
	nowarns,
	unadmin,
	unban,
	unwarn,
	updateUser,
	warn,
};
