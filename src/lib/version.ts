/**
 * Bump APP_VERSION on a release with user-visible changes worth announcing.
 * Anyone whose profile.lastSeenVersion !== APP_VERSION gets the "what's
 * new" modal (see ChangelogModal + markChangelogSeenAction) once, the next
 * time they load the app; dismissing it records APP_VERSION on their
 * profile so it doesn't show again until the next bump.
 */
export const APP_VERSION = '3.0.0';

export interface ChangelogEntry {
  title: string;
  description: string;
}

export interface ChangelogRelease {
  version: string;
  entries: ChangelogEntry[];
}

/** Newest first. Shown in full to anyone catching up from an older version. */
export const CHANGELOG: ChangelogRelease[] = [
  {
    version: '3.0.0',
    entries: [
      {
        title: 'Real proportional Schedule grid',
        description:
          "Today, Week, and Month are now one Schedule page. Day and Week show an actual time-proportional calendar — a block's height and position match its real start time and duration, color-coded by tag — instead of a flat list. Drag a task onto another day in Week view to move it.",
      },
      {
        title: 'Calendar export & subscribe',
        description:
          'Settings → Calendar sync now has a private subscribe link for Apple/Google/Outlook — add it once and your schedule stays in sync automatically. There\'s also a one-off .ics download for today, the next 7 days, or the month.',
      },
      {
        title: 'Simpler navigation',
        description:
          '13 pages down to 5. Tasks, "Right now" / free-time, and Events are now tabs on one Tasks page. Profile, Availability, and Feedback are now tabs on one Settings page. Feasibility is renamed Insights.',
      },
    ],
  },
  {
    version: '2.0.0',
    entries: [
      {
        title: 'Pink theme',
        description: 'A second, light theme is now available in Settings → Profile, alongside the original dark theme.',
      },
      {
        title: 'Groups',
        description: "Create or join a group to see your group's shared free time and plan around each other's schedules.",
      },
    ],
  },
];
