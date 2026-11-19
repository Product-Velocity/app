---
issue: 552
status: done
logged: 2026-11-19
done: 2026-11-19
link: PR for issue 552 (the release version is assigned when merged)
title: Velocity report on a workspace with only build dates
---
Ashu, 2026-11-19, with two PDFs of the Velocity report on a Jira-filled workspace: "There is something wrong with the reporting data. When you look at the charts on total time, everything is empty, except some. Then when you select only build as the filter, the top chart shows data, some metrics show data and some not (the chart at the top and the where time goes). Also the list at the bottom does not show time spent data." And: "the building time value is populated, so we must have build start and end dates, right?" Yes: Building Time is computed from Start Building and the build end, so Build can be measured; Total and the gates need Start Discovery, gate decisions and Start Roll-Out, which that workspace does not have. Fixed: a stage with no later date runs to the end of the measure, the report says what is missing when too few can be measured, in flight follows the measure, and the list shows the time spent. See issue 552.
