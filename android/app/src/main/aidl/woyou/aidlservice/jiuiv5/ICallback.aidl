package woyou.aidlservice.jiuiv5;

/**
 * printing server result callback
 */
interface ICallback {

	oneway void onRunResult(boolean isSuccess);
	oneway void onReturnString(String result);
	oneway void onRaiseException(int code, String msg);
}
