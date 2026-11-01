# Staff & Security Bot

A Discord.js bot with Components V2 configuration panels, staff records, V2 message publishing, and basic server security automation.

## Included commands

- `/config` — server configuration panel. Configure staff role, log channel, security toggles, and thresholds.
- `/embed` — publish a Components V2 message to a selected text channel.
- `/staff warn|strike|note|profile|loa|return|promote|demote|remove-record` — staff management.
- `/security status` — show security status.
- `/security timeout` — manually timeout a member.

## Setup on GitHub and FadeHost

1. Upload `index.js`, `package.json`, `.gitignore`, and this README to your GitHub repository.
2. In FadeHost, connect the repository and select Node.js.
3. Use Node.js 20 or newer.
4. Set the startup file to `index.js` and the install command to `npm install` (if FadeHost asks).
5. Add environment variables in FadeHost's startup/environment settings:
   - `DISCORD_TOKEN` = bot token
   - `CLIENT_ID` = application ID
   - `GUILD_ID` = your test server ID (optional, but recommended while setting up)
   - `DATA_DIR` = your persistent storage directory (optional; use the exact path FadeHost provides for persistent storage)
6. Start/restart the bot. With `GUILD_ID`, slash commands should appear in that server quickly. Remove `GUILD_ID` later if you want global commands.

## Discord Developer Portal setup

Enable **Server Members Intent** and **Message Content Intent** under Bot > Privileged Gateway Intents. Invite the bot with `bot` and `applications.commands` scopes. Recommended permissions: View Channels, Send Messages, Read Message History, Manage Messages, Moderate Members, Manage Roles, and View Audit Log. Put the bot's highest role above the roles it needs to assign/remove.

## Important safety notes

- Give the bot only the permissions it needs. Do not give Administrator unless you understand the risk.
- The security features are basic automated guardrails, not a complete anti-nuke system. The destructive-action feature alerts and can timeout a repeated actor; it does not restore deleted channels or roles and cannot reliably identify every executor instantly.
- Anti-raid currently alerts when the join threshold is reached. It does not automatically ban new members.
- Message filtering can timeout members who trigger a rule. Test settings in a private test server first.
- `data.json` must be stored on FadeHost persistent storage if you want records/settings to survive container replacement or redeploys. Set `DATA_DIR` to FadeHost's persistent directory. Back up this file regularly.
- Discord Components V2 messages are not traditional embeds. The `/embed` command builds a V2 card using text display components, with no accent/sidebar color.

## Troubleshooting

- If commands do not appear, confirm `CLIENT_ID`, `GUILD_ID`, and that the bot has `applications.commands` scope. Restart after changing environment variables.
- If the bot cannot assign roles, move its role above the target roles and grant Manage Roles.
- If security message filters do not work, enable Message Content Intent in the Developer Portal and in the code's gateway intents (already enabled here).
