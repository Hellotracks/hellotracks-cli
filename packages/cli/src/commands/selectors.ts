import { listMembersAction, listPlacesAction } from "@hellotracks/ht-core/actions/index.js";
import type { CommandContext } from "@hellotracks/ht-core/types.js";

type JsonRecord = Record<string, unknown>;

export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function matchesMember(item: JsonRecord, selector: string): boolean {
  const normalized = selector.toLowerCase();
  return ["id", "username", "email", "name"].some((field) => String(item[field] ?? "").toLowerCase() === normalized);
}

function matchesPlace(item: JsonRecord, selector: string): boolean {
  const normalized = selector.toLowerCase();
  return ["id", "name", "address"].some((field) => String(item[field] ?? "").toLowerCase() === normalized);
}

export async function resolveMemberIds(context: CommandContext, selectors: string[] | undefined, all: boolean | undefined): Promise<string[] | undefined> {
  const selected = new Set<string>();
  if (all) {
    const data = await listMembersAction(context);
    data.items.forEach((item) => selected.add(String(item.id)));
  }
  for (const selector of selectors ?? []) {
    const exact = await listMembersAction(context, { uids: selector });
    if (exact.items.length === 1) {
      selected.add(String(exact.items[0]?.id));
      continue;
    }
    const allMembers = await listMembersAction(context);
    const matches = allMembers.items.filter((item) => matchesMember(item, selector));
    if (matches.length !== 1) {
      throw new Error(matches.length === 0 ? `No member matched ${selector}.` : `Member selector is ambiguous: ${selector}.`);
    }
    selected.add(String(matches[0]?.id));
  }
  return selected.size > 0 ? [...selected] : undefined;
}

export async function resolvePlaceIds(context: CommandContext, selectors: string[] | undefined, all: boolean | undefined): Promise<string[] | undefined> {
  const selected = new Set<string>();
  if (all) {
    const data = await listPlacesAction(context);
    data.items.forEach((item) => selected.add(String(item.id)));
  }
  for (const selector of selectors ?? []) {
    const exact = await listPlacesAction(context, { uids: selector });
    if (exact.items.length === 1) {
      selected.add(String(exact.items[0]?.id));
      continue;
    }
    const queried = await listPlacesAction(context, { query: selector, max: 50 });
    const matches = queried.items.filter((item) => matchesPlace(item, selector));
    if (matches.length === 1) {
      selected.add(String(matches[0]?.id));
      continue;
    }
    if (queried.items.length === 1) {
      selected.add(String(queried.items[0]?.id));
      continue;
    }
    throw new Error(queried.items.length === 0 ? `No place matched ${selector}.` : `Place selector is ambiguous: ${selector}.`);
  }
  return selected.size > 0 ? [...selected] : undefined;
}
