import type { SessionUser } from './session';

type UserLike = {
  _id?: unknown; id?: string; username: string; name: string; role: string; preset?: string | null; empCode?: string | null;
  lang?: string; mustChangePassword?: boolean;
};

/** The only user fields ever sent to the browser. */
export function publicUser(u: UserLike | SessionUser) {
  const id = 'id' in u && u.id ? u.id : String((u as UserLike)._id);
  return {
    id,
    username: u.username,
    name: u.name,
    role: u.role,
    preset: u.preset ?? null,
    empCode: u.empCode ?? null,
    lang: u.lang ?? 'hi',
    mustChangePassword: Boolean(u.mustChangePassword),
  };
}
