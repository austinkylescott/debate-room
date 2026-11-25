// A tiny path router: the app only has a home page and Room pages.
import { ref } from "vue";

export type Route =
  | { name: "home" }
  | { name: "room"; roomId: string }
  | { name: "host-link"; roomId: string; hostSecret: string }
  | { name: "not-found" };

export function parseRoute(pathname: string, hash: string): Route {
  if (pathname === "/") return { name: "home" };
  const room = pathname.match(/^\/r\/([a-z0-9]+)\/?$/);
  if (room) return { name: "room", roomId: room[1] };
  const host = pathname.match(/^\/r\/([a-z0-9]+)\/host\/?$/);
  if (host) return { name: "host-link", roomId: host[1], hostSecret: hash.replace(/^#/, "") };
  return { name: "not-found" };
}

export const route = ref<Route>(parseRoute(location.pathname, location.hash));

window.addEventListener("popstate", () => {
  route.value = parseRoute(location.pathname, location.hash);
});

export function navigate(path: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  route.value = parseRoute(location.pathname, location.hash);
}

export const roomPath = (roomId: string) => `/r/${roomId}`;
export const inviteUrl = (roomId: string) => `${location.origin}${roomPath(roomId)}`;
export const hostUrl = (roomId: string, hostSecret: string) =>
  `${location.origin}${roomPath(roomId)}/host#${hostSecret}`;
