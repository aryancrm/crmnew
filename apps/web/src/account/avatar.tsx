// A person as a circle: their picture, else their initials.

import { useEffect, useState } from "react";
import { initials } from "../auth";

const SIZE = {
  xs: "size-6 text-[10px]",
  sm: "size-9 text-[13px]",
  md: "size-11 text-sm",
  lg: "size-24 text-3xl",
} as const;

export function Avatar({
  person,
  size = "sm",
}: {
  person: { id: number; name: string; photo?: number | null };
  size?: keyof typeof SIZE;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [person.id, person.photo]);
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#2563eb] font-semibold text-white ${SIZE[size]}`}
    >
      {person.photo && !failed ? (
        <img
          src={`/api/people/${person.id}/photo/${person.photo}`}
          alt=""
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}
