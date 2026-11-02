import { useEffect, useRef, useState } from "react";
import {
  describeOffset,
  layoutMarkers,
  postPlacement,
  timeAtFraction,
  timelineRange,
} from "../timeline.ts";

export interface TimelinePostItem {
  id: string;
  offsetMs: number;
  conditions: string[];
  body: string;
  authorName: string;
  imageUrl: string | null;
}

/** How far a pointer has to travel before it counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3;
const ROW_HEIGHT_PX = 11;
const KEYBOARD_STEP_MS = 15 * 60_000;

const PLACEMENT_NOTE = {
  ok: "",
  early: "Can never appear: it's already outside the feed window when they start.",
  late: "Can never appear: it's timed after the study ends.",
};

/**
 * Every post on a line through the study. Drag one to change when it appears, or click one to see it
 * in the feed. Posts that can never appear are shown in red, so they can be dragged back in.
 */
export function PostTimeline({
  posts,
  lengthMs,
  windowHours,
  condition,
  elapsedMs,
  canEdit,
  onMove,
  onSelect,
}: {
  posts: readonly TimelinePostItem[];
  lengthMs: number;
  windowHours: number | null;
  condition: string;
  elapsedMs: number;
  canEdit: boolean;
  onMove: (id: string, timeMs: number) => void;
  onSelect: (id: string, timeMs: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; timeMs: number } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // Shown where it was dropped, until the saved version comes back.
  const [moved, setMoved] = useState<Map<string, number>>(new Map());
  const press = useRef<{ id: string; x: number; moved: boolean } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: new data from the server replaces these
  useEffect(() => {
    setMoved(new Map());
  }, [posts]);

  const timeOf = (post: TimelinePostItem) =>
    dragging?.id === post.id ? dragging.timeMs : (moved.get(post.id) ?? post.offsetMs);

  const placed = posts.map((post) => ({ ...post, offsetMs: timeOf(post) }));
  // The range only changes between drags, so the line doesn't shift under the pointer.
  const range = timelineRange(posts, lengthMs, windowHours);
  const markers = layoutMarkers(placed, range);
  const rows = Math.max(1, ...markers.map(({ row }) => row + 1));
  const toPercent = (ms: number) => ((ms - range.startMs) / (range.endMs - range.startMs)) * 100;

  const timeAtPointer = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    return box ? timeAtFraction((clientX - box.left) / box.width, range) : 0;
  };

  const finish = (post: TimelinePostItem, timeMs: number) => {
    setMoved((current) => new Map(current).set(post.id, timeMs));
    onMove(post.id, timeMs);
  };

  const shown = placed.find(({ id }) => id === (dragging?.id ?? hovered));
  const days = Array.from({ length: Math.floor(lengthMs / 86_400_000) + 1 }, (_, day) => day);

  return (
    <div className="pt-2 text-xs">
      <div className="relative mb-1 h-4 text-stone-500">
        {days.map((day) => (
          <span
            key={day}
            className="absolute -translate-x-1/2"
            style={{ left: `${toPercent(day * 86_400_000)}%` }}
          >
            {day * 24 >= lengthMs / 3_600_000 ? "End" : `Day ${day + 1}`}
          </span>
        ))}
      </div>
      <div
        ref={track}
        data-testid="post-timeline"
        className="relative rounded bg-stone-100"
        style={{ height: rows * ROW_HEIGHT_PX + 4 }}
      >
        {/* Before they arrive, and after the study ends. */}
        <div
          className="absolute inset-y-0 left-0 rounded-l bg-stone-200"
          style={{ width: `${toPercent(0)}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 rounded-r bg-stone-200"
          style={{ left: `${toPercent(lengthMs)}%` }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-sky-600"
          style={{ left: `${toPercent(elapsedMs)}%` }}
        />
        {placed.map((post) => {
          const marker = markers.find(({ id }) => id === post.id);
          const placement = postPlacement(post.offsetMs, lengthMs, windowHours);
          const inCondition = post.conditions.length === 0 || post.conditions.includes(condition);
          const source = posts.find(({ id }) => id === post.id) as TimelinePostItem;
          const color =
            placement === "ok"
              ? post.conditions.length > 0
                ? "bg-amber-500"
                : "bg-stone-600"
              : "bg-rose-600";

          return (
            <button
              key={post.id}
              type="button"
              aria-label={`Post by ${post.authorName}, ${describeOffset(post.offsetMs)}: ${post.body.slice(0, 60)}`}
              data-placement={placement}
              onPointerEnter={() => setHovered(post.id)}
              onPointerLeave={() => setHovered(null)}
              onPointerDown={(event) => {
                press.current = { id: post.id, x: event.clientX, moved: false };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (press.current?.id !== post.id || !canEdit) {
                  return;
                }
                if (
                  press.current.moved ||
                  Math.abs(event.clientX - press.current.x) >= DRAG_THRESHOLD_PX
                ) {
                  press.current.moved = true;
                  setDragging({ id: post.id, timeMs: timeAtPointer(event.clientX) });
                }
              }}
              onPointerUp={(event) => {
                const wasDrag = press.current?.moved;
                press.current = null;
                setDragging(null);
                if (wasDrag) {
                  finish(source, timeAtPointer(event.clientX));
                } else {
                  onSelect(post.id, post.offsetMs);
                }
              }}
              onPointerCancel={() => {
                press.current = null;
                setDragging(null);
              }}
              onKeyDown={(event) => {
                const step = { ArrowLeft: -KEYBOARD_STEP_MS, ArrowRight: KEYBOARD_STEP_MS }[
                  event.key
                ];
                if (step && canEdit) {
                  event.preventDefault();
                  finish(source, post.offsetMs + step);
                }
              }}
              className={`absolute h-2.5 w-2 touch-none rounded-sm ${color} ${inCondition ? "" : "opacity-25"} ${
                canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
              } ${dragging?.id === post.id ? "z-10 ring-2 ring-sky-500" : ""} hover:z-10 hover:ring-2 hover:ring-stone-900 focus-visible:ring-2 focus-visible:ring-sky-600`}
              style={{
                left: `calc(${marker?.left ?? 0}% - 4px)`,
                top: (marker?.row ?? 0) * ROW_HEIGHT_PX + 2,
              }}
            />
          );
        })}
      </div>

      <div className="mt-1 flex min-h-9 items-start gap-2" aria-live="polite">
        {shown ? (
          <>
            {shown.imageUrl && (
              <img src={shown.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
            )}
            <p className="min-w-0">
              <strong>{shown.authorName}</strong>, {describeOffset(shown.offsetMs)}
              {shown.conditions.length > 0 && `, only in ${shown.conditions.join(", ")}`}.{" "}
              <span className="text-rose-800">
                {PLACEMENT_NOTE[postPlacement(shown.offsetMs, lengthMs, windowHours)]}
              </span>{" "}
              <span className="text-stone-600">{shown.body.slice(0, 120)}</span>
            </p>
          </>
        ) : (
          <p className="text-stone-500">
            {canEdit
              ? "Drag a post to change when it appears, or click it to see it."
              : "Click a post to see it."}{" "}
            Red can never appear. Amber is only in some conditions. Faded isn't in this condition.
          </p>
        )}
      </div>
    </div>
  );
}
