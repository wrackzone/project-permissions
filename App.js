var app = null;
var topLevelProject = "Corporate Initiatives";

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items:{ html:'<a href="https://help.rallydev.com/apps/2.0rc2/doc/">App SDK 2.0rc2 Docs</a>'},
    launch: function() {

        app = this;
        console.log("launch");
        this.rows = [];
        this.exporter = Ext.create("GridExporter");
        this.context = this.getContext();
        // setup the ui
        this.addExportButton();
        this.createGrid();
        
        // start the queries
        this.getObjects();

    },
    
    addExportButton : function () {
        var that = this;
        var button = Ext.create('Rally.ui.Button', {
            text: 'Export',
            handler: function() {
                //Ext.Msg.alert('Button', 'You clicked me');
                that.exporter.exportGrid(that.grid);
            }
        });
        this.add(button);
    },
    
    // <script type="text/javascript" src="https://rally1.rallydev.com/apps/2.0rc1/sdk-debug.js?apiVersion=1.43"></script>
    
    getObjects : function() {
        
        myMask = new Ext.LoadMask(Ext.getBody(), {msg:"Please wait..."});
        myMask.show();
        
        this.workspace = this.getContext().getWorkspace();
        console.log("worksapce",this.workspace);
        
        var that = this;
        var configs = [];
        
        configs.push({ model : "User", 
                       fetch : ['UserName','Editors', 'LastLoginDate', "SubscriptionAdmin","UserPermissions","NetworkID","FirstName","LastName","MiddleName","LastLoginDate"], 
                       filters : [ { property : "UserName", operator : "contains", value : "@"},
                                    { property : "Disabled", operator : "=", value : false }
                       ]
        });
        configs.push({ model : "Project", 
                       fetch : ['ObjectID','Name','Parent',"Description"], 
                       filters : []
        });

        async.map( configs, this.wsapiQuery, function(err,results) {
            
            console.log("results",results);
            that.users                = results[0];
            that.projects             = results[1];
            
            async.map( that.users, that.loadUserPermissions, function( err,results){
                _.each(that.users, function(user,i){
                    user.WorkspacePermissions = results[i];
                });
                console.log("users:",that.users.length);
                that.processProjects();    
            });
            
        });
    },
    
    processProjects : function ( ) {
        
        var that = this;
        
        // organize projects into tree
        console.log("tree");
        _.each( that.projects,function(project) {
            if (project.get("Parent")!==null) {
                var parent = _.find( that.projects, function(p) { return p.get("ObjectID") === project.get("Parent")["ObjectID"];});
                if (parent) {
                    if ( _.isUndefined( parent["Children"] ) ) {
                        parent.Children = [];
                    }
                    parent.Children.push(project);
                }
            }
        });
        console.log("tree done!");
        
        console.log("load editors");
        async.map( that.projects, that.loadEditors, function(err,results) {
            _.each(that.projects, function(project,i) {
                project.Editors = results[i];
            });
            console.log("load editors done!");
            that.scanUsers();
        });

    },
    
    addToEditors : function ( project, editors) {
        
        _.each(project.Editors, function(editor){
            editors.push(editor.data.UserName);
        })
        
        _.each(project.Children, function(child) {
            app.addToEditors(child,editors);
        });
        
    },
    
    scanUsers : function() {
        var that = this;
        
        var topLevel = _.find( that.projects, function(p) { return p.get("Name") === topLevelProject });
        
        var projectEditors = _.map( topLevel.Children, function(child) {
            var editors = [];
            that.addToEditors(child,editors);
            editors = _.sortBy(_.uniq(editors));
            return { name : child.get("Name"), project : child, editors : editors }
        });
        
        console.log("project editors:",projectEditors);
        _.each(that.users,function(user) {
            if ( user.get("SubscriptionAdmin") === false && 
                    that.hasWorkspacePermissions(user) == true && 
                    that.isWorkspaceAdmin(user) === false ) {
                        console.log("user:",user.get("UserName"));
                        _.each(projectEditors,function(pe) {
                            if ( pe.editors.indexOf(user.get("UserName")) != -1) {
                                console.log( user.get("UserName"), pe.project.get("Name"));
                                that.addRow(user,pe.project,false);
                            }
                        });
            }
        });
        // admins
        _.each(that.users,function(user) {
        if ( that.hasWorkspacePermissions(user) == true && 
            ( user.get("SubscriptionAdmin") === true || that.isWorkspaceAdmin(user) === true )) {
                _.each(topLevel.Children,function(project) {
                    that.addRow(user,project,true);
                });
            }
        });

        this.store.load();
        myMask.hide();
    },
    
    isWorkspaceAdmin : function ( user ) {
        var r = false;
        _.each( user.WorkspacePermissions, function(wsp) {
            if ( wsp["Role"] == "Admin")
                r = true;
        })
        return r;
    },
    
    hasWorkspacePermissions : function ( user ) {
        
        return ( user.WorkspacePermissions.length > 0 );

    },
    
    recurseProjects : function ( project, user ) {
        console.log("rp:",project,user);
        if (this.editorInProject( project, user ))
            return true;
            
        if (!_.isUndefined(project.Children)) {
            for ( x = 0 ; x < project.Children.length ; x++)
                if (this.recurseProjects(project.Children[x],user))
                    return true;
        }
        
        return false;
    },
    
    editorInProject : function( project , user) {
        
        var r = false;
        
        _.each( project.Editors, function (editor) {
            if ( editor.get("_ref") === user.get("_ref"))
                r = true;
        })
        
        return r;
        
    },
    
    loadUserPermissions : function ( user, callback) {

    	console.log("loading for user:",user.get("UserName"));
        
        var query = "(User.UserName = \"" + user.get("UserName") + "\")";
        // have to use old query to get workspace permissions
        legacyUtils._runLegacyQuery( app.context,function(results) { 
            // filter the results to just the current workspace
            var workspacePermissions = _.filter( results.Results, function( wsp ) { 
                return wsp["Workspace"]["ObjectID"]===(app.workspace["ObjectID"]); 
            });
            //console.log("wsp",workspacePermissions)
            callback(null,workspacePermissions);
        }, "WorkspacePermission",query,"Workspace,Name,Role,ObjectID" );
        
    },

    loadEditors : function ( child, callback) {
        child.getCollection("Editors").load({
            fetch : true,
            callback : function(records,operation,success) {
                callback(null,records);
            }
        })
    },

    wsapiQuery : function( config , callback ) {
        Ext.create('Rally.data.WsapiDataStore', {
            autoLoad : true,
            limit : "Infinity",
            
            model : config.model,
            fetch : config.fetch,
            filters : config.filters,
            listeners : {
                scope : this,
                load : function(store, data) {
                    callback(null,data);
                }
            }
        });
    },
    
    createGrid : function() {
        
        this.store = Ext.create('Rally.data.custom.Store', {
            fields: [
                    { name : "target" ,          type : "string"},
                    { name : "accountid" ,          type : "string"},
                    { name : "userid" ,             type : "string"},
                    { name : "usernamelast",        type : "string"},
                    { name : "usernamefirst",       type : "string"}, 
                    { name : "usernamemiddle",      type  : "string"},
                    { name : "usernamesuffix",      type : "string"}, 
                    { name : "resourcetype",        type : "string"},
                    { name : "resourcename",        type : "string"},
                    { name : "resourcedesc",        type : "string"},
                    { name : "resourceattributename",type : "string"},
                    { name : "resourceattributevalue",type : "string"},
                    { name : "timelastaccess",    type : "string" },
                    { name : "timeextracted",       type : "date"  }
            ],
            data : this.rows
        });
        
        this.grid = Ext.create('Rally.ui.grid.Grid', {
            store: this.store,
            columnCfgs: [
                { text : 'TARGET',                  dataIndex: 'target'},
                { text : 'ACCOUNT_ID',              dataIndex: 'accountid'},
                { text : 'USER_ID',                 dataIndex: 'userid'},
                { text : 'USER_NAME_LAST',          dataIndex: 'usernamelast'},
                { text : 'USER_NAME_FIRST',         dataIndex: 'usernamefirst'},
                { text : 'USER_NAME_MIDDLE',        dataIndex: 'usernamemiddle'},
                { text : 'USER_NAME_SUFFIX',        dataIndex: 'usernamesuffix'},
                { text : 'RESOURCE_TYPE',           dataIndex: 'resourcetype'},
                { text : 'RESOURCE_NAME',           dataIndex: 'resourcename'},
                { text : 'RESOURCE_DESC',           dataIndex: 'resourcedesc'},
                { text : 'RESOURCE_ATTRIBUTE_NAME', dataIndex: 'resourceattributename'},
                { text : 'RESOURCE_ATTRIBUTE_VALUE',dataIndex: 'resourceattributevalue'},
                { text : 'TIME_LAST_ACCESSED',      dataIndex: 'timelastaccess', renderer: Ext.util.Format.dateRenderer('m-d-Y')},
                { text : 'TIME_EXTRACTED',          dataIndex: 'timeextracted', renderer: Ext.util.Format.dateRenderer('m-d-Y')}
            ]
        });
        
        this.add(this.grid);
    },
    
    addRow : function ( user, project, admin) {
    	var lastLogin = user.get("LastLoginDate") !== null ? Rally.util.DateTime.fromIsoString(user.get("LastLoginDate")) : "None";
    	console.log("last login:",lastLogin);
        this.rows.push( {
            target : "Rally",
            accountid : user.get("UserName"),
            userid : user.get("NetworkID"),
            usernamelast : user.get("LastName"),
            usernamefirst : user.get("FirstName"),
            usernamemiddle : user.get("MiddleName"),
            usernamesuffix : "",
            resourcetype : "Role",
            resourcename : project.get("Name"),
            resourcedesc : project.get("Description"),
            resourceattributename : "Access Level",
            resourceattributevalue : (admin === true ? "Admin" : "Editor"),
            timelastaccess : lastLogin,
            timeextracted : new Date()
        });
    }
});
            
                    // utility function to call rally wsapi directly. (does not use store)
    // this._runQuery( function(results) { that.gTags = results.Results;} ,"Tags","","ObjectID,Name");

var legacyUtils = {

    _runLegacyQuery : function(context,cb,typeName,query,fetch) {
    
        var qr = {
            Results : []    
        };
        
        var count = 1-200;
        var app = this;
        var process = function() {
            count += 200;
            
            //console.log("fetch",fetch);
    
            Ext.Ajax.request({
                method: 'GET',
                //url: "https://demo01.rallydev.com/slm/webservice/1.43/"+typeName+".js",
                url: "https://rally1.rallydev.com/slm/webservice/1.43/"+typeName+".js",
                params: {
                    workspace : context.getWorkspace()._ref,
                    project   : context.getProject()._ref,
                    projectScopeDown: true,
                    pagesize: 200,
                    start: count,
                    // formatting happening as part of fetch
                    //fetch: ['ObjectID','Tags'].join(','),
                    fetch: fetch,
                    query: query
                },
                success: function(res) {
                    //console.log("res",res);
                    res = JSON.parse(res.responseText);
//                        console.log("res",res);
                    qr.Results = qr.Results.concat(res.QueryResult.Results);
                    //console.log("qr.results",qr.Results);
                    //if (res.QueryResult.TotalResultCount >= qr.Results.length) {
                    if (res.QueryResult.Results.length < 200) {
                        cb(qr,app);
                    } else {
                        process();
                    }
                }
            });
        }
        
        process();
    }
    
};
                // Derived and simplified from example on bryntum.com

Ext.define("GridExporter", {
    //dateFormat : 'Y-m-d g:i',
    dateFormat : 'Y-m-d',

    exportGrid: function(grid) {
        if (Ext.isIE) {
            this._ieToExcel(grid);

        } else {
            var data = this._getCSV(grid);
            window.location = 'data:text/csv;charset=utf8,' + encodeURIComponent(data);
        }
    },

    _escapeForCSV: function(string) {
        if (string.match(/,/)) {
            if (!string.match(/"/)) {
                string = '"' + string + '"';
            } else {
                string = string.replace(/,/g, ''); // comma's and quotes-- sorry, just loose the commas
            }
        }
        return string;
    },

    _getFieldText: function(fieldData) {
        var text;

        if (fieldData == null || fieldData == undefined) {
            text = '';

        } else if (fieldData._refObjectName && !fieldData.getMonth) {
            text = fieldData._refObjectName;

        } else if (fieldData instanceof Date) {
            text = Ext.Date.format(fieldData, this.dateFormat);

        } else if (!fieldData.match) { // not a string or object we recognize...bank it out
            text = '';

        } else {
            text = fieldData;
        }

        return text;
    },

    _getFieldTextAndEscape: function(fieldData) {
        var string  = this._getFieldText(fieldData);

        return this._escapeForCSV(string);
    },

    _getCSV: function (grid) {
        var cols    = grid.columns;
        var store   = grid.store;
        var data    = '';

        console.log("store",store);
        var that = this;
        Ext.Array.each(cols, function(col, index) {
            if (col.hidden != true) {
                data += that._getFieldTextAndEscape(col.text) + ',';
            }
        });
        data += "\n";

        // store.each(function(record) {
        _.each( store.proxy.data, function(record) {
            //var entry       = record.getData();
            Ext.Array.each(cols, function(col, index) {
                if (col.hidden != true) {
                    var fieldName   = col.dataIndex;
                    //var text        = entry[fieldName];
                    var text        = record[fieldName];

                    data += that._getFieldTextAndEscape(text) + ',';
                }
            });
            data += "\n";
        });

        return data;
    },

    _ieGetGridData : function(grid, sheet) {
        var that            = this;
        var resourceItems   = grid.store.data.items;
        var cols            = grid.columns;

        Ext.Array.each(cols, function(col, colIndex) {
            if (col.hidden != true) {
                console.log('header: ', col.text);
                sheet.cells(1,colIndex + 1).value = col.text;
            }
        });

        var rowIndex = 2;
        grid.store.each(function(record) {
            var entry   = record.getData();

            Ext.Array.each(cols, function(col, colIndex) {
                if (col.hidden != true) {
                    var fieldName   = col.dataIndex;
                    var text        = entry[fieldName];
                    var value       = that._getFieldText(text);

                    sheet.cells(rowIndex, colIndex+1).value = value;
                }
            });
            rowIndex++;
        });
    },

    _ieToExcel: function (grid) {
        if (window.ActiveXObject){
            var  xlApp, xlBook;
            try {
                xlApp = new ActiveXObject("Excel.Application"); 
                xlBook = xlApp.Workbooks.Add();
            } catch (e) {
                Ext.Msg.alert('Error', 'For the export to work in IE, you have to enable a security setting called "Initialize and script ActiveX control not marked as safe" from Internet Options -> Security -> Custom level..."');
                return;
            }

            xlBook.worksheets("Sheet1").activate;
            var XlSheet = xlBook.activeSheet;
            xlApp.visible = true; 

           this._ieGetGridData(grid, XlSheet);
           XlSheet.columns.autofit; 
        }
    }
});
