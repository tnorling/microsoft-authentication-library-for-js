module.exports = {
    displayName: "Customizable E2E Test Sample",
    globals: {
        __PORT__: 30662,
        __STARTCMD__: "cd .. && npm start -- -s 'customizable-e2e-test' -p 30662"
    },
    preset: "../../../../e2eTestUtils/jest-puppeteer-utils/jest-preset.js"
};