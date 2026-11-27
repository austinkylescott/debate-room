// Cloudflare Worker entry. Serves the Room API and Room WebSockets; the Vue app
// itself is served as static assets (see wrangler.jsonc).
import { getServerByName, routePartykitRequest } from "partyserver";
import type { CreateRoomRequest, CreateRoomResponse } from "../src/room/protocol";
import { PARTY_PREFIX } from "../src/room/protocol";

export { Room } from "./room-server";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return createRoom(request, env);
    }
    const party = await routePartykitRequest(request, env, { prefix: PARTY_PREFIX });
    return party ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function createRoom(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Partial<CreateRoomRequest> | null;
  if (typeof body?.hostNickname !== "string") {
    return json({ ok: false, message: "A Host nickname is required." }, 400);
  }
  if (typeof body.pin !== "string") {
    return json({ ok: false, message: "A Host PIN is required." }, 400);
  }
  if (body.participantLimit !== undefined && typeof body.participantLimit !== "number") {
    return json({ ok: false, message: "The Participant limit must be a number." }, 400);
  }
  const roomId = randomId(10);
  const hostSecret = randomId(32);
  const room = await getServerByName(env.Room, roomId);
  const rejection = await room.create({
    hostSecret,
    hostNickname: body.hostNickname,
    pin: body.pin,
    participantLimit: body.participantLimit,
  });
  if (rejection) return json({ ok: false, code: rejection.code, message: rejection.message }, 400);
  return json({ ok: true, roomId, hostSecret }, 201);
}

function json(body: CreateRoomResponse, status: number): Response {
  return Response.json(body, { status });
}

// Lowercase letters and digits without look-alikes (0/o, 1/l), so ids read well aloud.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function randomId(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
