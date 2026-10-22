#import <Foundation/Foundation.h>
#import <CoreWLAN/CoreWLAN.h>

static int reply(NSDictionary *value){
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    fwrite(data.bytes,1,data.length,stdout);fputc('\n',stdout);return 0;
}
int main(void){@autoreleasepool{
    NSData *data=[[NSFileHandle fileHandleWithStandardInput] readDataOfLength:8193];
    if(data.length>8192)return reply(@{@"ok":@NO,@"code":@"invalidInput"});
    NSDictionary *v=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if(![v isKindOfClass:[NSDictionary class]])return reply(@{@"ok":@NO,@"code":@"invalidInput"});
    NSString *ssid=v[@"ssid"],*password=v[@"password"],*security=v[@"security"];
    if(![ssid isKindOfClass:[NSString class]]||ssid.length==0||[ssid lengthOfBytesUsingEncoding:NSUTF8StringEncoding]>32||![password isKindOfClass:[NSString class]]||![@[@"wpa2",@"wpa3",@"open"] containsObject:security])return reply(@{@"ok":@NO,@"code":@"invalidInput"});
    if([v[@"action"] isEqual:@"validateOnly"])return reply(@{@"ok":@YES,@"networkTouched":@NO});
    if(![v[@"action"] isEqual:@"connect"])return reply(@{@"ok":@NO,@"code":@"invalidInput"});
    CWWiFiClient *client=[CWWiFiClient sharedWiFiClient];
    CWInterface *interface=[v[@"interface"] isKindOfClass:[NSString class]]?[client interfaceWithName:v[@"interface"]]:client.interface;
    if(!interface)return reply(@{@"ok":@NO,@"code":@"notFound"});
    NSError *error=nil;NSData *ssidData=[ssid dataUsingEncoding:NSUTF8StringEncoding];
    NSSet<CWNetwork *> *networks=[interface scanForNetworksWithSSID:ssidData includeHidden:YES error:&error];
    if(!networks)return reply(@{@"ok":@NO,@"code":error.code==kCWOperationNotPermittedErr?@"permissionDenied":@"failed"});
    CWSecurity required=[security isEqual:@"open"]?kCWSecurityNone:[security isEqual:@"wpa3"]?kCWSecurityWPA3Personal:kCWSecurityWPA2Personal;
    CWNetwork *chosen=nil;BOOL securityMismatch=NO,redacted=NO;
    for(CWNetwork *network in networks){
        if(!network.ssidData){redacted=YES;continue;}
        if(![network.ssidData isEqual:ssidData])continue;
        if(![network supportsSecurity:required]){securityMismatch=YES;continue;}
        if(!chosen||network.rssiValue>chosen.rssiValue)chosen=network;
    }
    if(!chosen)return reply(@{@"ok":@NO,@"code":redacted?@"permissionDenied":securityMismatch?@"unsupportedSecurity":@"notFound"});
    if([v[@"force"] boolValue])[interface disassociate];
    BOOL result=[interface associateToNetwork:chosen password:[security isEqual:@"open"]?nil:password error:&error];
    if(!result){
        BOOL rejected=error.code==kCWInvalidPMKErr||error.code==kCWChallengeFailureErr;
        return reply(@{@"ok":@NO,@"code":rejected?@"authRejected":error.code==kCWOperationNotPermittedErr?@"permissionDenied":@"failed"});
    }
    return reply(@{@"ok":@YES,@"code":@"associated"});
}}
