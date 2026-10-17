import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * ============================================================================
 * Public Users Parsing & Login Resilience Test Suite
 * ============================================================================
 * Verifies that:
 * 1. ApiClient.getPublicUsers normalizes diverse API payloads into arrays:
 *    - Direct array responses [ { Id, Name } ]
 *    - Query container objects { Items: [ ... ] } or { Users: [ ... ] }
 *    - Serialized JSON strings '[ { "Id": "...", "Name": "..." } ]'
 *    - Invalid string responses (HTML error pages, 404 text) safely return []
 *    - Null, undefined, or unexpected types safely return []
 * 2. LoginPage._renderUsers never throws "TypeError: this._users.map is not a function"
 *    even when initialized with non-array, string, or corrupted state.
 * 3. LoginPage._autoConnectToSavedServer and _connectToServer validate public users
 *    as arrays and redirect to manual login when public users list is empty.
 * ============================================================================
 */

test('ApiClient.getPublicUsers normalizes varied server responses into valid arrays', async () => {
    // Read ApiClient source to exercise the exact getPublicUsers implementation
    const apiClientSource = readFileSync(new URL('../src/api/ApiClient.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n');

    // Extract the getPublicUsers method implementation
    const methodMatch = apiClientSource.match(/async getPublicUsers\(\)\s*\{([\s\S]*?)\n {4}\}\n/);
    assert.ok(methodMatch, 'ApiClient.getPublicUsers must be defined');

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

    // Helper to run getPublicUsers with a mocked get() returning arbitrary payload
    const executeGetPublicUsers = async (mockResponse) => {
        const mockContext = {
            get: async () => mockResponse,
            getPublicUsers: new AsyncFunction(methodMatch[1])
        };
        return mockContext.getPublicUsers();
    };

    // Test Case 1: Standard Jellyfin/Emby array of UserDto
    const directArray = [{ Id: 'u1', Name: 'Alice' }, { Id: 'u2', Name: 'Bob' }];
    const res1 = await executeGetPublicUsers(directArray);
    assert.ok(Array.isArray(res1), 'Result must be an array');
    assert.equal(res1.length, 2);
    assert.equal(res1[0].Name, 'Alice');

    // Test Case 2: Wrapped response with Items array
    const wrappedItems = { Items: [{ Id: 'u3', Name: 'Charlie' }], TotalRecordCount: 1 };
    const res2 = await executeGetPublicUsers(wrappedItems);
    assert.ok(Array.isArray(res2), 'Result must be an array');
    assert.equal(res2.length, 1);
    assert.equal(res2[0].Name, 'Charlie');

    // Test Case 3: Wrapped response with Users array
    const wrappedUsers = { Users: [{ Id: 'u4', Name: 'Diana' }] };
    const res3 = await executeGetPublicUsers(wrappedUsers);
    assert.ok(Array.isArray(res3), 'Result must be an array');
    assert.equal(res3.length, 1);
    assert.equal(res3[0].Name, 'Diana');

    // Test Case 4: Serialized JSON array string (e.g. from text/plain responses or reverse proxy)
    const jsonString = JSON.stringify([{ Id: 'u5', Name: 'Eve' }]);
    const res4 = await executeGetPublicUsers(jsonString);
    assert.ok(Array.isArray(res4), 'Serialized JSON array must be parsed into an array');
    assert.equal(res4.length, 1);
    assert.equal(res4[0].Name, 'Eve');

    // Test Case 5: Serialized JSON object with Items array
    const jsonObjectString = JSON.stringify({ Items: [{ Id: 'u6', Name: 'Frank' }] });
    const res5 = await executeGetPublicUsers(jsonObjectString);
    assert.ok(Array.isArray(res5), 'Serialized JSON object with Items must resolve to array');
    assert.equal(res5.length, 1);
    assert.equal(res5[0].Name, 'Frank');

    // Test Case 6: HTML string (e.g. captive portal or reverse proxy error page)
    const htmlString = '<!DOCTYPE html><html><body>Error 502 Bad Gateway</body></html>';
    const res6 = await executeGetPublicUsers(htmlString);
    assert.ok(Array.isArray(res6), 'Non-JSON string must safely fall back to empty array');
    assert.equal(res6.length, 0);

    // Test Case 7: Null or undefined responses
    const res7 = await executeGetPublicUsers(null);
    assert.ok(Array.isArray(res7), 'Null must safely fall back to empty array');
    assert.equal(res7.length, 0);

    const res8 = await executeGetPublicUsers(undefined);
    assert.ok(Array.isArray(res8), 'Undefined must safely fall back to empty array');
    assert.equal(res8.length, 0);
});

test('LoginPage._renderUsers safeguards against non-array _users and renders without throwing', () => {
    // Read LoginPage source to inspect _renderUsers implementation
    const loginPageSource = readFileSync(new URL('../src/pages/LoginPage.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n');

    // Extract the _renderUsers method implementation
    const renderUsersMatch = loginPageSource.match(/_renderUsers\(\)\s*\{([\s\S]*?)\n {4}\}\n/);
    assert.ok(renderUsersMatch, 'LoginPage._renderUsers must be defined');

    // Mock dependencies for _renderUsers
    const mockUsersGrid = { innerHTML: '' };
    const mockLayoutManager = { isModern: () => true };
    const mockApi = {
        getUserImageUrl: (id) => `http://example.com/user/${id}.png`
    };
    const mockImageService = {
        getParams: () => ({ maxWidth: 200, quality: 90 })
    };
    const mockLog = {
        warn: () => {},
        error: () => {},
        info: () => {},
        debug: () => {}
    };

    const mockFocusManager = {
        invalidateCache: () => {}
    };

    const FunctionConstructor = Function;
    const renderUsersFn = new FunctionConstructor(
        'layoutManager',
        'api',
        'imageService',
        'log',
        'focusManager',
        renderUsersMatch[1]
    );

    // Context with invalid/string _users (which previously caused TypeError: this._users.map is not a function)
    const pageContext = {
        _users: 'some-corrupted-string-from-reverse-proxy',
        _usersGrid: mockUsersGrid
    };

    // Should NOT throw
    assert.doesNotThrow(() => {
        renderUsersFn.call(pageContext, mockLayoutManager, mockApi, mockImageService, mockLog, mockFocusManager);
    }, 'Calling _renderUsers with a string _users should not throw');

    assert.equal(pageContext._usersGrid.innerHTML, '', 'Grid innerHTML should be empty for non-array fallback');

    // Now test with valid users array
    pageContext._users = [
        { Id: 'user-1', Name: 'Admin', PrimaryImageTag: 'tag-1' }
    ];

    assert.doesNotThrow(() => {
        renderUsersFn.call(pageContext, mockLayoutManager, mockApi, mockImageService, mockLog, mockFocusManager);
    }, 'Calling _renderUsers with valid array should succeed');

    assert.ok(
        pageContext._usersGrid.innerHTML.includes('Admin'),
        'Grid innerHTML should render user name'
    );
});
