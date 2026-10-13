// The sign-in part of the employee form is just a password. The role comes from the Job chosen above (Manager, Accountant,
// Supervisor, Salesperson, Worker / operator), and the mobile number is the sign-in ID. Leave the password empty for someone who
// does not need to sign in.
const ROLE_OF_JOB = { Manager: 'manager', Accountant: 'accountant', Supervisor: 'supervisor', Salesperson: 'salesperson' };
export const roleOfJob = (job) => ROLE_OF_JOB[job] ?? 'worker';

export function loginFields() {
  return [
    { name: 'loginPassword', label: 'Password', type: 'password', noGenerate: true, placeholder: 'Password to sign in (leave empty if not needed)', wide: true },
  ];
}

/** employee form → the `login` object for the API, or null when nothing about the sign-in changed */
export function toLogin(body, { hasLogin, originalJob } = {}) {
  const { loginPassword, job } = body;
  const role = roleOfJob(job);
  if (loginPassword) return { enabled: true, role, password: loginPassword };
  if (hasLogin && job !== undefined && job !== originalJob) return { enabled: true, role }; // the job changed: the sign-in follows it
  return null;
}
