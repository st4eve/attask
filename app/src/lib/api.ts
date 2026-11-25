import { parseRef, type BoardItem, type ItemDetail } from "../../../worker/src/types";
export type { BoardItem, ItemDetail };
export { HOME_REPO, REPOS } from "../../../worker/src/config";

/** Worker connection settings, kept in localStorage on this device. */
export interface Settings {
  /** Worker base address, no trailing slash */
  url: string;
  /** app key sent as the bearer token */
  key: string;
}

/** Reads the saved settings, empty strings if none. */
export function loadSettings(): Settings {
  return {
    url: localStorage.getItem("attask.url") ?? "",
    key: localStorage.getItem("attask.key") ?? "",
  };
}

/** Saves the settings to localStorage. */
export function saveSettings(settings: Settings): void {
  localStorage.setItem("attask.url", settings.url);
  localStorage.setItem("attask.key", settings.key);
}

/** Normalises what the user typed: adds `http://` if missing and drops trailing slashes. */
export function workerBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** Calls the Worker with the given settings and returns the parsed JSON. Throws an error saying what is wrong if the settings are empty, the Worker is unreachable, or it refuses or answers badly. */
async function send<T>(settings: Settings, path: string, body?: object, method: string = body ? "POST" : "GET"): Promise<T> {
  const { url, key } = settings;
  if (!url.trim() || !key) throw new Error("enter the worker url and app key in Settings");
  const base = workerBase(url);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}` },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`can't reach ${base} (wrong address, worker not running, or origin not in ALLOWED_ORIGINS)`);
  }
  if (res.status === 401) throw new Error("the app key is wrong");
  // 409 is a board rule saying no, with its reason
  if (res.status === 409) throw new Error(((await res.json()) as { error: string }).error);
  if (!res.ok) throw new Error(`worker returned ${res.status}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Calls the Worker with the saved settings. See `send`. */
function request<T>(path: string, body?: object, method?: string): Promise<T> {
  return send(loadSettings(), path, body, method);
}

/** Checks typed settings against the Worker without saving them. Returns the number of board items it answered with. Throws what is wrong if it can't connect. */
export async function testConnection(settings: Settings): Promise<number> {
  return (await send<BoardItem[]>(settings, "/board")).length;
}

/** Forgets the saved Worker address and app key on this device. */
export function clearSettings(): void {
  localStorage.removeItem("attask.url");
  localStorage.removeItem("attask.key");
}

/** One Status the Worker changed, which may include tasks paused along with a project. */
export interface StatusWrite {
  id: string;
  ref: string;
  status: string;
}

/** The Worker path of an issue, e.g. `owner/name#3` → `/issues/owner/name/3`. Throws on a malformed ref. */
export function issuePath(ref: string): string {
  const parsed = parseRef(ref);
  if (!parsed) throw new Error(`bad ref ${ref}`);
  return `/issues/${parsed.repo}/${parsed.number}`;
}

/** Fetches every board item from the Worker. */
export function fetchBoard(): Promise<BoardItem[]> {
  return request("/board");
}

/** Fetches an issue's body and comments as HTML. */
export function fetchDetail(ref: string): Promise<ItemDetail> {
  return request(`${issuePath(ref)}/detail`);
}

/** Asks the Worker to set an item's status. Returns every status it changed. Throws the board rule's reason if it refuses. */
export async function postStatus(id: string, status: string): Promise<StatusWrite[]> {
  return (await request<{ writes: StatusWrite[] }>(`/items/${id}/status`, { status })).writes;
}

/** Asks the Worker to create a task in a repo; it lands in the board's Inbox. Returns the new issue's number and address. */
export function postTask(title: string, repo: string): Promise<{ number: number; url: string }> {
  return request("/tasks", { title, repo });
}

/** Asks the Worker to permanently delete an inbox task's issue. Throws the Worker's reason if it refuses. */
export function deleteTask(ref: string): Promise<void> {
  return request(issuePath(ref), undefined, "DELETE");
}

/** Asks the Worker to close a triaged task's issue as not planned. Throws the Worker's reason if it refuses. */
export function closeTaskNotPlanned(ref: string): Promise<void> {
  return request(`${issuePath(ref)}/not-planned`, {});
}

/** Asks the Worker to set an item's priority. Throws the board rule's reason if it refuses. */
export async function postPriority(id: string, priority: string): Promise<void> {
  await request(`/items/${id}/priority`, { priority });
}
