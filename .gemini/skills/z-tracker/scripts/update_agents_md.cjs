const fs = require('fs');
const path = require('path');

const agentsMdPath = path.resolve(process.cwd(), 'AGENTS.md');
// The script now expects the exact 'Name' column content (e.g., "Payments + Allocations")
const phaseNameInTable = process.argv[2];
const newStatus = process.argv[3];

if (!phaseNameInTable || !newStatus) {
    console.error('Usage: node update_agents_md.cjs "<Exact Phase Name from AGENTS.md>" "<New Status Text>"');
    console.error('Example: node update_agents_md.cjs "Payments + Allocations" "Completed"');
    process.exit(1);
}

const statusMap = {
    "Completed": "✅ Complete",
    "On Track": "⏳ In Progress",
    "At Risk": "⚠️ At Risk",
    "Delayed": "⛔ Delayed"
};

const displayStatus = statusMap[newStatus] || newStatus;

fs.readFile(agentsMdPath, 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading AGENTS.md:', err);
        process.exit(1);
    }

    const lines = data.split('\n');
    let inTable = false;
    let tableHeaderIndex = -1;
    const updatedLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes('Phase Status Tracker')) {
            inTable = true;
        }

        if (inTable && tableHeaderIndex === -1 && line.includes('| Phase | Name | Status | Key Deliverables |')) {
            tableHeaderIndex = i;
        }

        if (inTable && tableHeaderIndex !== -1 && i > tableHeaderIndex + 1) { // Skip header and separator line
            if (!line.trim().startsWith('|')) {
                inTable = false;
                tableHeaderIndex = -1;
            } else {
                const parts = line.split('|').map(p => p.trim());
                // parts[0] is empty, parts[1] is 'Phase', parts[2] is 'Name', parts[3] is 'Status'
                if (parts.length > 3 && parts[2] === phaseNameInTable) {
                    parts[3] = displayStatus;
                    updatedLines.push(parts.join(' | '));
                    continue; // Skip pushing the original line
                }
            }
        }
        updatedLines.push(line);
    }

    fs.writeFile(agentsMdPath, updatedLines.join('\n'), 'utf8', (err) => {
        if (err) {
            console.error('Error writing AGENTS.md:', err);
            process.exit(1);
        }
        console.log(`Successfully updated status for "${phaseNameInTable}" to "${displayStatus}" in AGENTS.md.`);
    });
});
