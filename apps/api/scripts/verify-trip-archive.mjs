import assert from 'node:assert/strict';
import { createPrismaClient } from '@trove/db';
const db = createPrismaClient();
const other = createPrismaClient();
if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname))
  throw new Error('Local verification only');
let id;
try {
  const owner = await db.profile.findFirst({ select: { id: true } });
  assert(owner);
  const trip = await db.trip.create({
    data: {
      ownerId: owner.id,
      name: 'Archive verification fixture',
      startDate: new Date('2026-10-19'),
      endDate: new Date('2026-10-23'),
      referenceTimeZone: 'UTC',
      referenceTimeZoneSource: 'EXPLICIT',
      visibility: 'PUBLIC',
    },
  });
  id = trip.id;
  const task = await db.task.create({ data: { tripId: id, label: 'Keep passport' } });
  const reservation = await db.reservation.create({ data: { tripId: id, title: 'Keep booking' } });
  await db.expense.create({
    data: { tripId: id, title: 'Keep expense', amount: 42, currencyCode: 'USD' },
  });
  await db.tripInfo.create({
    data: { tripId: id, label: 'Keep note', value: 'Useful information' },
  });
  const memory = await db.memory.create({
    data: {
      tripId: id,
      note: 'Keep memory',
      capturedInstant: new Date(),
      capturedLocalDate: new Date('2026-10-20'),
      capturedLocalTime: new Date('1970-01-01T10:00Z'),
      timeZone: 'UTC',
      timeZoneSource: 'TRIP_REFERENCE',
    },
  });
  const photo = await db.memoryPhoto.create({
    data: {
      memoryId: memory.id,
      path: 'fixture/no-upload',
      fileName: 'fixture.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 10,
      position: 0,
    },
  });
  await db.trip.update({ where: { id }, data: { archivedAt: new Date() } });
  for (const change of [
    () => db.task.create({ data: { tripId: id, label: 'Blocked' } }),
    () => db.task.update({ where: { id: task.id }, data: { label: 'Blocked' } }),
    () => db.task.delete({ where: { id: task.id } }),
    () => db.reservation.update({ where: { id: reservation.id }, data: { title: 'Blocked' } }),
    () => db.memoryPhoto.update({ where: { id: photo.id }, data: { position: 1 } }),
    () => db.trip.update({ where: { id }, data: { name: 'Blocked' } }),
  ])
    await assert.rejects(change, /trip_archived/);
  const kept = await db.trip.findUnique({
    where: { id },
    include: {
      tasks: true,
      reservations: true,
      expenses: true,
      tripInfoEntries: true,
      memories: { include: { photos: true } },
    },
  });
  assert.equal(kept.visibility, 'PUBLIC');
  assert.equal(kept.tasks[0].label, 'Keep passport');
  for (const key of ['tasks', 'reservations', 'expenses', 'tripInfoEntries', 'memories'])
    assert.equal(kept[key].length, 1);
  assert.equal(kept.memories[0].photos.length, 1);
  await db.trip.update({ where: { id }, data: { archivedAt: null } });
  await db.task.update({ where: { id: task.id }, data: { label: 'Restored edit' } });
  // Hold archive's lock, start a content write on a second connection, then
  // release the archive commit. The waiting write must see the new state.
  let locked;
  const acquired = new Promise((resolve) => (locked = resolve));
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const archiving = db.$transaction(async (tx) => {
    await tx.trip.update({ where: { id }, data: { archivedAt: new Date() } });
    locked();
    await gate;
  });
  await acquired;
  const writing = other.task.update({ where: { id: task.id }, data: { label: 'Race must fail' } });
  const rejected = assert.rejects(writing, /trip_archived/);
  release();
  await archiving;
  await rejected;
  // Permanent deletion remains an explicit operation, including cascades.
  await db.trip.delete({ where: { id } });
  assert.equal(await db.task.count({ where: { tripId: id } }), 0);
  assert.equal(await db.memoryPhoto.count({ where: { memoryId: memory.id } }), 0);
  id = undefined;
  console.log(
    'PASS: archive preserves all fixture content; archived insert/update/delete and root edits blocked; restore edits work; archive/write race blocked; explicit deletion cascades.',
  );
} finally {
  if (id) await db.trip.delete({ where: { id } });
  await Promise.all([db.$disconnect(), other.$disconnect()]);
}
