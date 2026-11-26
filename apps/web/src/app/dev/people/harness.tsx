"use client";

import { useState } from "react";
import { PeopleNotInvited, type NotInvitedPerson, type PeopleActions } from "../../(workspace)/settings/members/people-list";

const START: NotInvitedPerson[] = [
  { id: "p1", name: "Jane Doe", email: "jane@meridian.test", initiatives: 3 },
  { id: "p2", name: "Ravi Rao", email: null, initiatives: 1 },
  { id: "p3", name: "Mika Aalto", email: "mika@meridian.test", initiatives: 0 },
];
const MEMBERS = [{ user_id: "u1", email: "lena@meridian.test" }, { user_id: "u2", email: "omar@meridian.test" }];

/** In-memory stand-ins for the server actions, with the same rules as the database (one address once, a name is needed). */
export function HarnessPeople() {
  const [people, setPeople] = useState(START);
  const actions: PeopleActions = {
    async addPerson(name, email) {
      if (!name.trim()) return { ok: false, error: "Enter a name of 1 to 120 characters" };
      if (email && [...people].some((p) => p.email === email.toLowerCase())) return { ok: false, error: "Someone with that email is on the list already" };
      setPeople((all) => [...all, { id: `n${all.length}`, name: name.trim(), email: email.trim().toLowerCase() || null, initiatives: 0 }]);
      return { ok: true };
    },
    async updatePerson(id, name, email) {
      setPeople((all) => all.map((p) => (p.id === id ? { ...p, name: name.trim(), email: email.trim() || null } : p)));
      return { ok: true };
    },
    async removePerson(id) { setPeople((all) => all.filter((p) => p.id !== id)); return { ok: true }; },
    async linkPerson(id) { setPeople((all) => all.filter((p) => p.id !== id)); return { ok: true }; },
  };
  return (
    <div className="page-wide">
      <h1>Members</h1>
      <PeopleNotInvited people={people} members={MEMBERS} workspaceName="Meridian Media" emailEnabled actions={actions} />
    </div>
  );
}
