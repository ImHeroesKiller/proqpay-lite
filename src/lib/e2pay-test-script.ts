export const E2PAY_TEST_SCRIPT = [
  [1, "Registration", "Get Access Token", "{\"access_token\": \"==\",\"refresh_token\": \"\",\"token_type\": \"\",\"expires_in\":}"],
  [2, "Registration", "Request Registration", "{\"merchantRegistrationId\":\"\",\"tokenPrefix\":\"\",\"accountGroupId\":\"\",\"username\":\"\"}"],
  [3, "Registration", "Request Registration Confirm", "{\"merchantId\": \"\"}"],
  [4, "Registration", "Missing Mandatory Field {} …, etc", "{\"code\":\"\",\"refId\":\"\",\"errors\":[\"phone harus diisi\",\"Silahkan hubungi 021-52920138.\"]}"],
  [5, "Registration", "Number Already Registered", "{\"code\":\"\",\"refId\":\"\",\"errors\":[\"Nomor seluler '[nomor uji]' sudah terdaftar\",\"Silahkan hubungi 021-52920138.\"]}"],
  [6, "Registration", "Invalid OTP", "{\"code\":\"\",\"refId\":\"\",\"errors\":[\"Kode verifikasi salah\",\"Silahkan hubungi 021-52920138.\"]}"],
  [7, "Registration", "Invalid client_id", "Unknown client_id"],
  [8, "Registration", "Invalid client_secret", "Wrong client_secret"],
  [9, "Login", "Get Authorization", "{\"status\": \"00\",\"code\": \"\"}"],
  [10, "Login", "Get Oauth Token", "{\"access_token\": \"\",\"refresh_token\": \"\",\"token_type\": \"Bearer\",\"expires_in\":}"],
  [11, "Login", "Number Not Registered", "Nomor seluler tidak terdaftar"],
  [12, "Login", "Missing Mandatory Field {} …, etc", "Bad Request"],
  [13, "Login", "Invalid Code", "Wrong code"],
  [14, "Login", "Invalid PIN/Password", "Otentikasi user gagal"],
  [15, "Login", "Invalid client_id", "Unknown client_id"],
  [16, "Login", "Invalid client_secret", "Wrong client_secret"],
  [17, "Get Account", "Get Account", "{\"accountId\": \"\",\"merchantStatus\": \"\",\"registrationTimestamp\": \"\",\"accountTypeId\": \"\",\"balance\": ,\"accountName\": \"\",\"accountGroupId\": \"\",\"phone\": \"\",\"accountGroupName\": \"\",\"accountTypeName\": \"\"}"],
  [18, "Get Account", "Access Token Invalid", "Invalid access_token"],
  [19, "Transaction History", "Get History Success", "{\"data\":[{\"accountTransactionId\":\"\",\"accountId\":\"\",\"accountName\":\"\",\"merchantId\":\"\",\"merchantName\":\"\",\"amount\":,\"transactionCode\":\"\",\"transactionName\":\"\",\"description\":\"\",\"clientRef\":\"\",\"debitAmount\":,\"creditAmount\":,\"balanceBefore\":,\"balance\":,\"transactionTimestamp\":\"\",\"accountGroupId\":\"01\",\"accountGroupName\":\"E2pay\",\"journalId\":\"\",\"responseCode\":\"\",\"responseMessage\":\"\",\"correlationId\":\"\",\"channelId\":\"\",\"customData\":{\"bankId\":\"\",\"accountDst\":\"\",\"bankName\":\"\",\"accountDstName\":\"\"}}"],
  [20, "Transaction History", "Get With Param Max Limit = 100", "{\"data\":[{\"accountTransactionId\":\"\",\"accountId\":\"\",\"accountName\":\"\",\"merchantId\":\"\",\"merchantName\":\"\",\"amount\":,\"transactionCode\":\"\",\"transactionName\":\"\",\"description\":\"\",\"clientRef\":\"\",\"debitAmount\":,\"creditAmount\":,\"balanceBefore\":,\"balance\":,\"transactionTimestamp\":\"\",\"accountGroupId\":\"01\",\"accountGroupName\":\"E2pay\",\"journalId\":\"\",\"responseCode\":\"\",\"responseMessage\":\"\",\"correlationId\":\"\",\"channelId\":\"\",\"customData\":{\"bankId\":\"\",\"accountDst\":\"\",\"bankName\":\"\",\"accountDstName\":\"\"}}"],
  [21, "Transaction History", "clientRef Invalid", "{\"data\":[],\"rowCount\":0}"],
  [22, "Get Bank List", "Get Bank List Success", "{\"data\": [{\"id\": \"\",\"name\": \"\",\"active\": },{\"id\": \"\",\"name\": \"\",\"active\": }],\"rowCount\":}"],
  [23, "Get Bank List", "Get Bank List With Invalid Name", "{\"data\": [],\"rowCount\": 0}"],
  [24, "Transaction", "Inquiry Success", "{\"accountId\": \"\",\"feeAmount\": ,\"amount\": ,\"bankId\": \"\",\"merchantId\": \"\",\"requestTimestamp\": \"\",\"name\": \"\",\"id\": \"\"}"],
  [25, "Transaction", "Invalid bankId", "{\"code\": \"E1\",\"refId\": \"d769122273f24fa3ac94e15004b7ce62\",\"errors\": [\"Bank tidak terdaftar\",\"Silahkan hubungi 021-52920138.\"]}"],
  [26, "Transaction", "Missing Mandatory Field {} …, etc", "{\"code\": \"E1\",\"refId\": \"\",\"errors\": [\"Name Field\",\"Silahkan hubungi 021-52920138.\"]}"],
  [27, "Transaction", "Unauthorized . Signature", "{\"code\": \"E1\",\"refId\": \"46e583e01ccc4f7189918f8e0588dab0\",\"errors\": [\"Unauthorized Signature\",\"Silahkan hubungi 021-52920138.\"]}"],
  [28, "Transaction", "amount < Rp 10.000", "{\"code\": \"500\",\"refId\": \"a8e4b4df43fe480fa75e037b4c0ce0cd\",\"errors\": [\"Minimum Amount 10.000\",\"Silahkan hubungi 021-52920138.\"]}"],
  [29, "Transaction", "Payment Success", "{\"accountDstId\": \"\",\"amount\": ,\"transactionCodeId\": \"\",\"accountGroupId\": \"\",\"accountGroupName\": \"\",\"journalId\": \"\",\"clientRef\": \"\",\"description\": \"\",\"clientTimestamp\": \"\",\"transactionTimestamp\": \"\",\"responseCode\": \"\",\"accountSrcId\": \"\",\"feeAmount\": ,\"merchantId\": \"\",\"accountSrcName\": \"\",\"accountGroupEmail\": \"\",\"correlationId\": \"\",\"responseMessage\": \"\",\"accountDstName\": \"\"}"],
  [30, "Transaction", "Missing Mandatory Field {} …, etc", "{\"code\":\"16\",\"refId\":\"\",\"errors\":[\"Name Field\" Not Found,\"Silahkan hubungi 021-52920138.\"]}"],
  [31, "Transaction", "Invalid PIN/Password", "{\"code\":\"\",\"refId\":\"\",\"errors\":[\"Otentikasi user gagal\",\"Silahkan hubungi 021-52920138.\"]}"],
  [32, "Transaction", "Invalid inquiryId", "{\"code\": \"400\",\"refId\": \"a933264b3f2447f3bce5007c45970619\",\"errors\": [\"Please do another inquiry\",\"Silahkan hubungi 021-52920138.\"]}"],
  [33, "Transaction", "amount > balance", "{\"code\":\"\",\"refId\":\"\",\"errors\":[\"Saldo tidak mencukupi\",\"Silahkan hubungi 021-52920138.\"]}"],
] as const;

export function assessE2PayScenario(id:number, result:Record<string,unknown>){
  const outcome=(passed:boolean,reason:string)=>({status:passed?'Passed':'Failed',reason});
  const rejected=typeof result.providerStatus==='number' && result.providerStatus>=400
    && (result.providerStatus<500 || (id===28 && result.providerStatus===500));
  if(id===6||id===25||id===28){
    const matches=id===6
      ? result.stage==='REGISTER_CONFIRM' && result.providerReason==='INVALID_OTP'
      : result.stage==='INQUIRY' && (id===25
        ? result.providerCode==='E1' && result.providerReason==='BANK_REJECTED'
        : result.providerCode==='500' && result.providerReason==='AMOUNT_REJECTED');
    return outcome(rejected&&matches,'E2Pay harus menolak pada tahap yang diuji dengan alasan yang sesuai.');
  }
  if(id===21||id===23){
    return outcome(result.ok===true && result.rowCount===0 && Array.isArray(result.data) && result.data.length===0,'Respons sukses harus berisi daftar kosong dan rowCount 0.');
  }
  const token=result.token as Record<string,unknown>|undefined;
  const authorization=result.authorization as Record<string,unknown>|undefined;
  const account=result.account as Record<string,unknown>|undefined;
  const inquiry=result.inquiry as Record<string,unknown>|undefined;
  const checks:Partial<Record<number,boolean>>={
    1:token?.accessTokenReceived===true,
    2:typeof result.merchantRegistrationId==='string' && !!result.merchantRegistrationId && result.tokenPrefixReceived===true,
    3:typeof result.merchantId==='string' && !!result.merchantId,
    9:authorization?.status==='00' && authorization.authorizationCodeReceived===true,
    10:token?.accessTokenReceived===true && String(token.tokenType).toLowerCase()==='bearer',
    17:account?.available===true && Boolean(account.accountIdMasked) && typeof account.balance==='number',
    19:Array.isArray(result.data) && typeof result.rowCount==='number',
    20:Array.isArray(result.data) && result.data.length<=100 && typeof result.rowCount==='number',
    22:Array.isArray(result.data) && typeof result.rowCount==='number',
    24:Boolean(inquiry?.id) && typeof inquiry?.feeAmount==='number',
  };
  return id in checks ? outcome(result.ok===true&&checks[id]===true,'Respons harus sukses dan memuat bukti yang diharapkan.') : undefined;
}
