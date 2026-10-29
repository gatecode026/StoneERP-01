import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import { connect, disconnect } from '../lib/db';
import { Attendance, Employee } from '../lib/models';
import { getSettings } from '../lib/settings';
import { calcDay } from '../lib/attendance/calc';
import { dayKind } from '../lib/attendance/calendar';
import { shiftFor } from '../lib/services/punch';

async function main() {
  await connect();
  const settings = await getSettings();
  const docs: any[] = await Attendance.find({ inAt: { $ne: null }, state: 'absent' }).lean();
  console.log(`Found ${docs.length} attendance records with inAt but state='absent'`);

  for (const doc of docs) {
    const emp: any = await Employee.findOne({ empCode: doc.empCode }).lean();
    const shift = shiftFor(settings, emp);
    const kind = dayKind(doc.date, settings.workHours).kind;
    const calc = calcDay({
      date: doc.date,
      shift,
      inAt: new Date(doc.inAt),
      outAt: doc.outAt ? new Date(doc.outAt) : null,
      kind,
      openAfterHours: settings.workHours.openDayAfterHours,
    });
    console.log(`Fixing ${doc.empCode} on ${doc.date}: ${doc.state} -> ${calc.state} (worked: ${calc.workedMinutes}m, OT: ${calc.otMinutes}m)`);
    await Attendance.updateOne(
      { _id: doc._id },
      {
        $set: {
          state: calc.state,
          workedMinutes: calc.workedMinutes,
          otMinutes: calc.otMinutes,
        },
      }
    );
  }

  console.log('Done!');
  await disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
