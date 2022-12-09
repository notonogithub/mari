import type { CacheableRemoteUser } from '@/models/entities/user.js';
import { IRemoteUser, User } from '@/models/entities/user.js';
import DbResolver from '@/remote/activitypub/db-resolver.js';
import { getRemoteUser } from '@/server/api/common/getters.js';
import { updatePerson } from '@/remote/activitypub/models/person.js';
import { Followings, Users } from '@/models/index.js';
import { makePaginationQuery } from '@/server/api/common/make-pagination-query.js';
import deleteFollowing from '@/services/following/delete.js';
import create from '@/services/following/create.js';
import { getUser } from '@/server/api/common/getters.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { ApiError } from '@/server/api/error.js';
import { meta } from '@/server/api/endpoints/following/create.js';
import { IObject, IActor } from '../../type.js';
import type { IMove } from '../../type.js';
import Resolver from '@/remote/activitypub/resolver.js';

export default async (actor: CacheableRemoteUser, activity: IMove): Promise<string> => {
	// ※ There is a block target in activity.object, which should be a local user that exists.

	const dbResolver = new DbResolver();
	const resolver = new Resolver();
	let new_acc = await dbResolver.getUserFromApId(activity.target);
	let actor_new;
	if (!new_acc) actor_new = await resolver.resolve(<string>activity.target) as IActor;

	if ((!new_acc || new_acc.uri === null) && (!actor_new || actor_new.id === null)) {
		return 'move: new acc not found';
	}

	let newUri: string | null | undefined
	newUri = new_acc ? new_acc.uri :
		actor_new?.url?.toString();

	if(newUri === null || newUri === undefined) return 'move: new acc not found #2';

	await updatePerson(newUri);
	await updatePerson(actor.uri!);

	new_acc = await dbResolver.getUserFromApId(newUri);
	let old = await dbResolver.getUserFromApId(actor.uri!);

	if (old === null || old.uri === null || !new_acc?.alsoKnownAs?.includes(old.uri)) return 'move: accounts invalid';

	old.movedToUri = new_acc.uri;

	const followee = await getUser(actor.id).catch(e => {
		if (e.id === '15348ddd-432d-49c2-8a5a-8069753becff') throw new ApiError(meta.errors.noSuchUser);
		throw e;
	});

	const followeeNew = await getUser(new_acc.id).catch(e => {
		if (e.id === '15348ddd-432d-49c2-8a5a-8069753becff') throw new ApiError(meta.errors.noSuchUser);
		throw e;
	});

	const followings = await Followings.findBy({
		followeeId: followee.id,
	});

	//TODO remove this
	console.log(followings);

	followings.forEach(async following => {
		//if follower is local
		if (!following.followerHost) {
			const follower = await getUser(following.followerId).catch(e => {
				if (e.id === '15348ddd-432d-49c2-8a5a-8069753becff') throw new ApiError(meta.errors.noSuchUser);
				throw e;
			});
			await deleteFollowing(follower!, followee);
			try {
				await create(follower!, followeeNew);
			} catch (e) {
				if (e instanceof IdentifiableError) {
					if (e.id === '710e8fb0-b8c3-4922-be49-d5d93d8e6a6e') return meta.errors.blocking;
					if (e.id === '3338392a-f764-498d-8855-db939dcf8c48') return meta.errors.blocked;
				}
				return e;
			}
		}
	});

	return 'ok';
};
