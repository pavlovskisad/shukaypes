// WHERE WE ARE WILLING TO SEND A PERSON.
//
// Every pin on the map is an invitation to walk somewhere and look. That
// invitation is only worth making when we can defend the coordinate, and
// for most of the table we cannot: measured on 193 active pets, 55 were
// placed by the model guessing from the ad's prose, 57 by matching a bare
// name with nothing in the ad marking it as a place, and 3 by a fuzzy
// match that produced a music school for an ad naming a village.
//
// Four of those reached the owner as screenshots. «Таруша» says «метро
// Спортивная» — a station that does not exist in Kyiv; it is in Kharkiv —
// and the model answered Олімпійська, so the app sent somebody to a
// stadium two kilometres from a dog in another city. «Тимошка» names
// «Бригади Хартії» and «м.Армійська», both Kharkiv, and got Печерськ.
//
// No list of other cities' street names would have caught those. What
// they have in common is not being Kharkiv — it is that NOTHING IN THE AD
// PUT THE ANIMAL WHERE WE DREW IT. That is the property to test, and the
// placement_source ledger (migration 0037) already records it.
//
// So: a pet appears only when its coordinate came from a person or from a
// place the ad explicitly named as one.
//
//   owner              the poster dropped the pin themselves
//   sighting           somebody reported seeing the animal there
//   gazetteer-marked:  the ad wrote «вул. X» / «район X» and X is in the
//                      gazetteer at a coordinate we hold
//
// Everything else is hidden: gazetteer-bare (a name matched with no
// marker in front of it), gazetteer-fuzzy, model-landmark, model-geo,
// fall-through, and null (rows predating the column, all model-placed).
//
// THE COST IS REAL AND WAS MEASURED BEFORE CHOOSING IT: this takes the
// map from 127 visible pets to roughly 28. A hidden pet is one nobody
// walks for, which is a genuine loss to its owner — but a pet drawn in
// the wrong district is worse than absent, because it spends somebody's
// afternoon and teaches them the map lies. The owner's call, made on
// those numbers.
//
// TO RELAX IT, add a prefix here. Nothing else needs to change: the SQL
// and the predicate are both generated from this list, and all three
// paths that can send a walker somewhere — the map pins, the search-zone
// spawner, and what the companion says is nearby — read it.
// …and a fourth, added once there was something to stand behind it:
//
//   gazetteer-judged:  the ad named the place with no «вул.» in front of
//                      it — «пропав пес на Оболоні» — and a model read
//                      the ad afterwards and confirmed the pin.
//
// Bare matches were hidden wholesale because one of them put «Горобчик»
// on Соборна площа in the centre when his ad said Софіївська Борщагівка.
// Reading all 44 of them afterwards, that judgement was unfair to the
// other 34: «на Оболоні» and «біля Лукʼянівської» are complete addresses
// in Ukrainian, and refusing them for lacking a marker refused how the
// language works. The ten that were genuinely wrong are wrong for
// reasons no matcher can see — «ракетної атаки» is not вул. Ракетна —
// so pipeline/placementJudge.ts asks a model, and only a confirmed one
// reaches this list. An unjudged bare placement stays hidden.
export const CONFIDENT_PLACEMENT_PREFIXES = [
  'owner',
  'sighting',
  'gazetteer-marked:',
  'gazetteer-judged:',
] as const;

/** Whether a placement_source value is one we will show a walker. */
export function isConfidentPlacement(source: string | null): boolean {
  if (!source) return false;
  return CONFIDENT_PLACEMENT_PREFIXES.some((p) =>
    p.endsWith(':') ? source.startsWith(p) : source === p,
  );
}

// The same rule as SQL, for the queries that must not fetch the rest.
//
// Built from the list above rather than written out, so the two cannot
// drift — a prefix added to the constant takes effect in both places or
// neither. Exact values compare with `=`; the ones ending in ':' are
// prefixes and compare with LIKE, the colon making «gazetteer-marked:»
// unable to match «gazetteer-marked-something-else» were such a tier
// ever added.
//
// NULL is excluded for free: `placement_source = 'owner'` and
// `placement_source LIKE '…'` are both NULL, never true, for a NULL
// column. It is spelled out in the OR chain anyway — a reader should not
// have to remember SQL's three-valued logic to see that legacy rows are
// hidden.
export function confidentPlacementSqlFragment(column: string): string {
  const clauses = CONFIDENT_PLACEMENT_PREFIXES.map((p) =>
    p.endsWith(':')
      ? `${column} LIKE '${p}%'`
      : `${column} = '${p}'`,
  );
  return `(${column} IS NOT NULL AND (${clauses.join(' OR ')}))`;
}
