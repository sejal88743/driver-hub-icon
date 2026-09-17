// Script to initialize Appwrite Database, Collections, and Attributes
const PROJECT_ID = process.env.APPWRITE_PROJECT_ID || '6aab782e002b92fe6f9e';
const API_KEY = process.argv[2] || process.env.APPWRITE_API_KEY || 'standard_e031aa4980652b8d5f822a8ce54d6c8d9c3e108753cc2b7d0a85a64e122a1931fcfd3425a13349c9162ca8715fe3bb8cce5e431a41b07448b50fc43898d2422e40a43833406748d734996636fbca2921da98ed50a6c607cffca98a42ad83072483b2edd031bbcf9a11cd7ba3e0db20e341d8a4a077e24a0cffc867b980b12b6c';
const ENDPOINT = process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const DATABASE_ID = 'vitratrack';
const DATABASE_NAME = 'VitraTrack';

const headers = {
  'Content-Type': 'application/json',
  'X-Appwrite-Project': PROJECT_ID,
  'X-Appwrite-Key': API_KEY,
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function request(path, method = 'GET', body = null) {
  const url = `${ENDPOINT}${path}`;
  const options = {
    method,
    headers,
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // 409 = already exists, which is acceptable
    if (res.status === 409) {
      return { alreadyExists: true, data };
    }
    const errMsg = data?.message || res.statusText || `HTTP ${res.status}`;
    const err = new Error(errMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function createDatabase() {
  console.log(`Checking database '${DATABASE_ID}'...`);
  try {
    await request(`/databases/${DATABASE_ID}`, 'GET');
    console.log(`Database '${DATABASE_ID}' already exists.`);
  } catch (err) {
    if (err.status === 404) {
      console.log(`Creating database '${DATABASE_ID}'...`);
      await request('/databases', 'POST', {
        databaseId: DATABASE_ID,
        name: DATABASE_NAME,
        enabled: true,
      });
      console.log(`✓ Database '${DATABASE_ID}' created successfully!`);
    } else {
      throw err;
    }
  }
}

async function createCollection(collectionId, name) {
  console.log(`Checking collection '${collectionId}'...`);
  try {
    await request(`/databases/${DATABASE_ID}/collections/${collectionId}`, 'GET');
    console.log(`Collection '${collectionId}' already exists.`);
  } catch (err) {
    if (err.status === 404) {
      console.log(`Creating collection '${collectionId}'...`);
      await request(`/databases/${DATABASE_ID}/collections`, 'POST', {
        collectionId,
        name,
        permissions: [
          'read("any")',
          'create("any")',
          'update("any")',
          'delete("any")',
        ],
        documentSecurity: false,
        enabled: true,
      });
      console.log(`✓ Collection '${collectionId}' created.`);
    } else {
      throw err;
    }
  }
}

async function addStringAttribute(collectionId, key, size = 255, required = false, defaultValue = null) {
  try {
    const payload = { key, size, required };
    if (defaultValue !== null) payload.default = defaultValue;
    const res = await request(`/databases/${DATABASE_ID}/collections/${collectionId}/attributes/string`, 'POST', payload);
    if (res?.alreadyExists) {
      // Attribute exists
      return;
    }
    console.log(`  + [string] ${key} (${size})`);
  } catch (err) {
    if (err.status === 409) return;
    console.warn(`  ! Warning creating string attr ${key}:`, err.message);
  }
}

async function addFloatAttribute(collectionId, key, required = false, defaultValue = null) {
  try {
    const payload = { key, required };
    if (defaultValue !== null) payload.default = defaultValue;
    const res = await request(`/databases/${DATABASE_ID}/collections/${collectionId}/attributes/float`, 'POST', payload);
    if (res?.alreadyExists) return;
    console.log(`  + [float] ${key}`);
  } catch (err) {
    if (err.status === 409) return;
    console.warn(`  ! Warning creating float attr ${key}:`, err.message);
  }
}

async function addIntegerAttribute(collectionId, key, required = false, defaultValue = null) {
  try {
    const payload = { key, required };
    if (defaultValue !== null) payload.default = defaultValue;
    const res = await request(`/databases/${DATABASE_ID}/collections/${collectionId}/attributes/integer`, 'POST', payload);
    if (res?.alreadyExists) return;
    console.log(`  + [integer] ${key}`);
  } catch (err) {
    if (err.status === 409) return;
    console.warn(`  ! Warning creating integer attr ${key}:`, err.message);
  }
}

async function addBooleanAttribute(collectionId, key, required = false, defaultValue = null) {
  try {
    const payload = { key, required };
    if (defaultValue !== null) payload.default = defaultValue;
    const res = await request(`/databases/${DATABASE_ID}/collections/${collectionId}/attributes/boolean`, 'POST', payload);
    if (res?.alreadyExists) return;
    console.log(`  + [boolean] ${key}`);
  } catch (err) {
    if (err.status === 409) return;
    console.warn(`  ! Warning creating boolean attr ${key}:`, err.message);
  }
}

async function setupBillsCollection() {
  await createCollection('bills', 'Bills');
  console.log('Adding attributes to bills collection...');

  // Strings
  const strFields = [
    { key: 'bill_no', size: 100 },
    { key: 'party_name', size: 255 },
    { key: 'party_code', size: 100 },
    { key: 'party_hul_code', size: 100 },
    { key: 'beat_name', size: 255 },
    { key: 'driver_name', size: 255 },
    { key: 'salesperson_name', size: 255 },
    { key: 'date', size: 50 },
    { key: 'payment_date', size: 50 },
    { key: 'payment_mode', size: 100 },
    { key: 'payment_method', size: 100 },
    { key: 'payment_time', size: 50 },
    { key: 'delivery_date', size: 50 },
    { key: 'cheque_no', size: 100 },
    { key: 'cheque_date', size: 50 },
    { key: 'bank_name', size: 255 },
    { key: 'collection_code', size: 100 },
    { key: 'discrepancy_reason', size: 1000 },
    { key: 'cancel_line', size: 255 },
    { key: 'next_bill_no', size: 100 },
    { key: 'sr_no', size: 100 },
    { key: 'owner', size: 255 },
    { key: 'user', size: 255 },
    { key: 'edit_date', size: 50 },
    { key: 'edit_history', size: 20000 },
    { key: 'del_pending_history', size: 10000 },
    { key: 'updated_at', size: 100 },
  ];

  for (const f of strFields) {
    await addStringAttribute('bills', f.key, f.size);
    await sleep(250);
  }

  // Floats
  const floatFields = [
    'bill_net_amt',
    'collected_amount',
    'outstanding_amount',
    'line_cut_amt',
    'cash_amount',
    'upi_amount',
    'cheque_amount',
  ];

  for (const f of floatFields) {
    await addFloatAttribute('bills', f);
    await sleep(250);
  }

  // Integer
  await addIntegerAttribute('bills', 'bill_ageing');
  await sleep(250);

  console.log('✓ Bills attributes created.');
}

async function setupDriversCollection() {
  await createCollection('drivers', 'Drivers');
  console.log('Adding attributes to drivers collection...');
  await addStringAttribute('drivers', 'name', 255);
  await sleep(250);
  console.log('✓ Drivers attributes created.');
}

async function setupBanksCollection() {
  await createCollection('banks', 'Banks');
  console.log('Adding attributes to banks collection...');
  await addStringAttribute('banks', 'name', 255);
  await sleep(250);
  console.log('✓ Banks attributes created.');
}

async function setupContactsCollection() {
  await createCollection('contacts', 'Contacts');
  console.log('Adding attributes to contacts collection...');
  await addStringAttribute('contacts', 'name', 255);
  await sleep(250);
  await addStringAttribute('contacts', 'mobile', 50);
  await sleep(250);
  await addStringAttribute('contacts', 'type', 50);
  await sleep(250);
  console.log('✓ Contacts attributes created.');
}

async function setupDriverSummariesCollection() {
  await createCollection('driver_summaries', 'Driver Summaries');
  console.log('Adding attributes to driver_summaries collection...');
  await addStringAttribute('driver_summaries', 'driver_name', 255);
  await sleep(250);
  await addStringAttribute('driver_summaries', 'date', 50);
  await sleep(250);
  await addFloatAttribute('driver_summaries', 'total_amount');
  await sleep(250);
  await addIntegerAttribute('driver_summaries', 'total_bill_count');
  await sleep(250);
  await addStringAttribute('driver_summaries', 'cash_breakdown', 10000);
  await sleep(250);
  console.log('✓ Driver Summaries attributes created.');
}

async function setupSettingsCollection() {
  await createCollection('settings', 'Settings');
  console.log('Adding attributes to settings collection...');
  await addStringAttribute('settings', 'key', 100);
  await sleep(250);
  await addStringAttribute('settings', 'value', 20000);
  await sleep(250);
  console.log('✓ Settings attributes created.');
}

async function main() {
  console.log('====================================================');
  console.log('Starting Appwrite Database & Collections Provisioning');
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Project:  ${PROJECT_ID}`);
  console.log('====================================================');

  await createDatabase();
  await setupBillsCollection();
  await setupDriversCollection();
  await setupBanksCollection();
  await setupContactsCollection();
  await setupDriverSummariesCollection();
  await setupSettingsCollection();

  console.log('\n====================================================');
  console.log('🎉 ALL APPWRITE TABLES & DATABASE CREATED SUCCESSFULLY!');
  console.log('Database ID:  vitratrack');
  console.log('Collections: bills, drivers, banks, contacts, driver_summaries, settings');
  console.log('Permissions: read("any"), create("any"), update("any"), delete("any")');
  console.log('====================================================');
}

main().catch(err => {
  console.error('Fatal Error during Appwrite setup:', err);
  process.exit(1);
});
